// LLMによる解析（AI活用）のサーバ側。文書から、スキーマ（ラベル・リレーションシップタイプ）と
// グラフデータ（ノード・リレーションシップ）の候補を抽出する。
//
// 【順番は固定】グラフデータ抽出には登録済みのスキーマだけを使う。スキーマ候補を登録したあと、
// 同じ文書でグラフデータ抽出をやり直すと、新しいラベル・タイプを使った候補が出る。
//
// 【文書は切らずに全部読む】長い文書は区切って何回かに分けて LLM に渡し、結果を1つにまとめる。
// 先頭だけを読んで後半を黙って捨てることはしない。
//
// 【既存データは変えない】ここで行うのは候補を作るところまで。登録・名寄せは人がアクションを
// 選んで実行したときに、各画面と同じ API を通して行う。

import Anthropic from "@anthropic-ai/sdk"
import { normalizeName } from "@/lib/normalize"
import { knowledgeScopePrompt } from "@/lib/knowledge-scope"
import type { GraphNode, Label, PropertyDef, Relationship, RelationshipType } from "@/lib/graph-types"
import {
  LLM_ANALYSIS_MODEL,
  type LabelCandidate, type LabelRef, type NodeCandidate, type NodeRef,
  type RelTypeCandidate, type RelationshipCandidate,
} from "@/lib/llm-analysis-types"

// 1回に渡す文書の長さ（文字数）。出力が長くなりすぎないよう、文書側を区切る。
const CHUNK_CHARS = 30000
// 同時に投げる回数
const CONCURRENCY = 3

// 既存ノードは、ラベル候補に個体（ノード）が混じらないよう「これはノードの例」として見せる
export type SchemaContext = { labels: Label[]; relTypes: RelationshipType[]; nodes?: GraphNode[] }
export type GraphContext = SchemaContext & {
  nodes: GraphNode[]
  relationships: Relationship[]
  propertyDefs: PropertyDef[]
}

// ───────────────────────── LLM 呼び出し ─────────────────────────

// JSON スキーマで形を決めて答えさせる（構造化出力）。長い出力になりうるのでストリームで受ける。
async function callStructured<T>(system: string, user: string, schema: Record<string, unknown>): Promise<T> {
  const client = new Anthropic()
  const stream = client.messages.stream({
    model: LLM_ANALYSIS_MODEL,
    max_tokens: 64000,
    output_config: { effort: "high", format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content: user }],
  })
  const message = await stream.finalMessage()
  if (message.stop_reason === "refusal") {
    throw new Error("LLM がこの文書の解析を断りました")
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error("LLM の出力が長すぎて途中で切れました")
  }
  const text = message.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
  return JSON.parse(text) as T
}

export function splitText(text: string): string[] {
  const chunks: string[] = []
  let rest = text.trim()
  while (rest.length > CHUNK_CHARS) {
    // なるべく段落・文の切れ目で区切る
    let cut = rest.lastIndexOf("\n\n", CHUNK_CHARS)
    if (cut < CHUNK_CHARS * 0.6) cut = rest.lastIndexOf("\n", CHUNK_CHARS)
    if (cut < CHUNK_CHARS * 0.6) cut = rest.lastIndexOf("。", CHUNK_CHARS) + 1
    if (cut < CHUNK_CHARS * 0.6) cut = CHUNK_CHARS
    chunks.push(rest.slice(0, cut))
    rest = rest.slice(cut).trim()
  }
  if (rest) chunks.push(rest)
  return chunks
}

async function mapChunks<T>(chunks: string[], fn: (chunk: string, index: number) => Promise<T>): Promise<T[]> {
  const results: T[] = new Array(chunks.length)
  let next = 0
  const workers = Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, async () => {
    while (true) {
      const i = next++
      if (i >= chunks.length) return
      results[i] = await fn(chunks[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

const partLabel = (i: number, n: number) => (n > 1 ? `（文書を${n}つに分けたうちの${i + 1}つ目）` : "")

// ───────────────────────── 名前の照合 ─────────────────────────

function labelByTerm(labels: Label[], term: string): Label | undefined {
  const key = normalizeName(term)
  if (!key) return undefined
  return labels.find((l) =>
    normalizeName(l.name) === key || (l.synonyms ?? []).some((s) => normalizeName(s) === key))
}

function typeByName(relTypes: RelationshipType[], name: string): RelationshipType | undefined {
  const key = normalizeName(name)
  return key ? relTypes.find((t) => normalizeName(t.name) === key) : undefined
}

function liveNodeByName(nodes: GraphNode[], name: string): GraphNode[] {
  const key = normalizeName(name)
  if (!key) return []
  return nodes.filter((n) => n.status !== "merged" &&
    (normalizeName(n.name) === key || (n.aliases ?? []).some((a) => normalizeName(a) === key)))
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|")

const newId = () => crypto.randomUUID()

// ───────────────────────── スキーマ抽出 ─────────────────────────

// グラフにする知見と、しない知見の線引き（知見の切り分け基準）。スキーマ抽出・グラフデータ抽出の両方に渡す。
// これがないと、トラブルの経緯やノウハウの文章まで何でもノードや関係にしてしまう。
// 基準そのものは lib/knowledge-scope.ts にあり、画面「知見の分類について」と同じものを使う。
const GRAPH_SCOPE_GUIDE = knowledgeScopePrompt()

const SCHEMA_SYSTEM = [
  "あなたはナレッジグラフのスキーマ設計者です。文書を読み、Neo4j のラベル付きプロパティグラフのスキーマとして、既存スキーマに足りないラベルとリレーションシップタイプの候補を挙げます。",
  "",
  GRAPH_SCOPE_GUIDE,
  "ラベルとリレーションシップタイプも、グラフにするものを表すためのものだけを挙げます。経緯・考察・ノウハウを表すためのラベルやタイプは作りません。",
  "",
  "ラベルとノードの区別（いちばん大事）：",
  "- ラベルは「種類・カテゴリ」の名前です。同じラベルを持つ個体（ノード）が何件もありうるものだけがラベルです（例：部品図面、材料、不具合事象、取引先）。",
  "- ノードは個々の具体物です。型番・図番・品番・製品名・固有名詞・人名や組織名・個別の出来事や事例・具体的な数値や規格値・特定の手順や作業そのもの・文書の章や項目の名前は、ノードであってラベルではありません。挙げないでください。",
  "  例：「SS400」「ERL-01-31」「中棚」「耐荷重150kg」「棚のガタつき」「連結金具の増し締め」はノード（それぞれ材料・部品図面・品質特性・不具合事象・対策というラベルの個体）です。",
  "- 【既存ノード】に載っているものと同じ種類の具体物は、ノードです。ラベルにしないでください。",
  "- 迷ったら、そのラベルを付けることになるノードを文書から2つ以上挙げられるか考えてください。exampleNodes に、文書中でそのラベルが付く具体物の名前を書きます。挙げられないなら、それはラベルではありません。",
  "",
  "ラベル：",
  "- 既存ラベルの名前・同義語とまったく同じものは挙げないでください。",
  "- 既存ラベルと同じ意味と思われる別の呼び方（表記ゆれ・言い換え）は挙げてください。そのとき similarExistingLabel にその既存ラベル名、similarReason に理由を書きます。",
  "- 既存ラベルと意味が近いが別の概念だと思うものも、similarExistingLabel と理由を書いて挙げてください。",
  "- 既存に似たものがない新しい概念なら similarExistingLabel と similarReason は空文字にします。",
  "",
  "リレーションシップタイプ：",
  "- 名前は既存タイプと同じ書き方に揃え、必ず「AはB」から始めます（例：「AはBを構成部品に持つ」「AはBに属する」「AはBで作られる」「AはBを審議する」）。Aが始点、Bが終点です。",
  "- 始点(A)・終点(B)は、既存ラベル名か、この回答で挙げたラベル候補名のどちらかにします。",
  "- 始点・終点には、その関係が当てはまるいちばん一般的なラベルを使います。同じ関係を下位の種類ごとに繰り返して挙げないでください。",
  "- 既存タイプと同じ名前で同じ始点・終点のものは挙げないでください。",
  "",
  "【絶対の禁止】能動と受動、向きを入れ替えただけの言い換えのリレーションシップタイプは、決して挙げてはいけません。",
  "- 例：「AはBを愛している」があるなら「AはBに愛されている」は挙げない。「AはBを構成部品に持つ」があるなら「AはBの構成部品である」「AはBに含まれる」は挙げない。「AはBを担当する」があるなら「AはBに担当される」は挙げない。",
  "- 関係は1つの向きのタイプ1つで表し、逆から読みたいときは同じタイプを終点側からたどります（Cypher では (b)<-[:LOVES]-(a) のように書けます）。",
  "- 両方の向きを登録してはいけない理由：",
  "  1. データの整合性が崩れる：片方を消してもう片方を消し忘れると、データが矛盾する。",
  "  2. 無駄が増える：同じ事実のリレーションシップが2倍になり、性能が落ちる。",
  "  3. LLM 検索（GraphRAG）が混乱する：Cypher を作るときにどちらのタイプを使うべきか迷い、精度が落ちる。",
  "- 既存タイプについても、この回答の中のタイプどうしについても同じです。同じ関係を両方の向きで挙げず、どちらか一方（原則として能動の向き）だけにします。",
  "- 既存タイプのAとBを入れ替えれば表せる関係を、うっかり挙げそうになったときは、inverseOfExistingType にその既存タイプ名を書いてください（こちらで外します）。それ以外は空文字にします。",
  "",
  "- 既存タイプと同じ意味だと思うもの、近い意味のものは、similarExistingType にその既存タイプ名、similarReason に理由を書きます。似たものがなければ空文字にします。",
  "",
  "evidence には根拠となる原文を短く抜き出してください。description は1〜2文で書きます。",
].join("\n")

const SCHEMA_FORMAT = {
  type: "object",
  additionalProperties: false,
  required: ["labels", "relationshipTypes"],
  properties: {
    labels: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "description", "evidence", "exampleNodes", "similarExistingLabel", "similarReason"],
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          evidence: { type: "string" },
          exampleNodes: { type: "array", items: { type: "string" } },
          similarExistingLabel: { type: "string" },
          similarReason: { type: "string" },
        },
      },
    },
    relationshipTypes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "description", "evidence", "sourceLabel", "targetLabel", "inverseOfExistingType", "similarExistingType", "similarReason"],
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          evidence: { type: "string" },
          sourceLabel: { type: "string" },
          targetLabel: { type: "string" },
          inverseOfExistingType: { type: "string" },
          similarExistingType: { type: "string" },
          similarReason: { type: "string" },
        },
      },
    },
  },
}

type SchemaRaw = {
  labels: {
    name: string; description: string; evidence: string; exampleNodes: string[]
    similarExistingLabel: string; similarReason: string
  }[]
  relationshipTypes: {
    name: string; description: string; evidence: string; sourceLabel: string; targetLabel: string
    inverseOfExistingType: string; similarExistingType: string; similarReason: string
  }[]
}

function schemaContextText({ labels, relTypes, nodes = [] }: SchemaContext): string {
  const labelName = new Map(labels.map((l) => [l.id, l.name]))
  const labelText = labels.filter((l) => !l.system).map((l) =>
    `- ${l.name}${l.synonyms?.length ? `（同義語: ${l.synonyms.join("、")}）` : ""}${l.description ? `：${l.description}` : ""}`,
  ).join("\n") || "（なし）"
  const typeText = relTypes.map((t) => {
    const pairs = (t.labelPairs ?? []).map((p) => `${labelName.get(p.sourceLabelId) ?? "?"}→${labelName.get(p.targetLabelId) ?? "?"}`)
    return `- ${t.name}（${pairs.join("、") || "ペアなし"}）`
  }).join("\n") || "（なし）"
  // ノードの例はラベルの組み合わせごとに数件ずつ。全件は要らない（何がノードかを示すため）
  const perLabel = new Map<string, number>()
  const sample: GraphNode[] = []
  for (const n of nodes) {
    if (n.status === "merged") continue
    const key = (n.labelIds ?? []).join(",")
    const count = perLabel.get(key) ?? 0
    if (count >= 5) continue
    perLabel.set(key, count + 1)
    sample.push(n)
  }
  const nodeText = sample.map((n) =>
    `- ${n.name}［${(n.labelIds ?? []).map((id) => labelName.get(id) ?? "?").join("・") || "ラベルなし"}］`,
  ).join("\n") || "（なし）"
  return `【既存ラベル】\n${labelText}\n\n【既存リレーションシップタイプ】（名前と、始点→終点のラベルペア）\n${typeText}\n\n` +
    `【既存ノード】（ノード＝個体の例。これらと同じ種類の具体物はラベルにしない）\n${nodeText}`
}

export async function extractSchema(
  text: string,
  ctx: SchemaContext,
): Promise<{ labels: LabelCandidate[]; relTypes: RelTypeCandidate[]; notes: string[] }> {
  const chunks = splitText(text)
  const context = schemaContextText(ctx)
  const raws = await mapChunks(chunks, (chunk, i) =>
    callStructured<SchemaRaw>(SCHEMA_SYSTEM, `${context}\n\n【文書】${partLabel(i, chunks.length)}\n${chunk}`, SCHEMA_FORMAT))

  const { labels, relTypes } = ctx
  const notes: string[] = []

  // ── ラベル候補 ──
  const labelCands: LabelCandidate[] = []
  const seenLabel = new Map<string, LabelCandidate>()
  let alreadyLabels = 0
  let nodeLike = 0
  const nodes = ctx.nodes ?? []
  for (const raw of raws) for (const l of raw.labels ?? []) {
    const name = l.name.trim()
    const key = normalizeName(name)
    if (!key) continue
    // 既存ラベルの名前・同義語と同じなら、もう登録済み
    if (labelByTerm(labels, name)) { alreadyLabels++; continue }
    // 付けるノードを挙げられないもの、既存ノードと同じ名前のものは、ラベルではなくノード
    if ((l.exampleNodes ?? []).filter((x) => x.trim()).length === 0 || liveNodeByName(nodes, name).length > 0) {
      nodeLike++
      continue
    }
    if (seenLabel.has(key)) continue
    let similar = l.similarExistingLabel ? labelByTerm(labels, l.similarExistingLabel) : undefined
    let reason = similar ? (l.similarReason || "AIの判断：同じ意味の可能性") : ""
    // LLM が挙げなくても、表記が包含関係にある既存ラベルは近いものとして出す
    if (!similar) {
      similar = labels.find((x) => !x.system && key.length >= 2 && normalizeName(x.name).length >= 2 &&
        (normalizeName(x.name).includes(key) || key.includes(normalizeName(x.name))))
      if (similar) reason = "表記が近い"
    }
    const cand: LabelCandidate = {
      id: newId(), status: "pending", name, description: l.description ?? "", evidence: l.evidence ?? "",
      similarLabelId: similar?.id ?? null, similarReason: reason,
    }
    seenLabel.set(key, cand)
    labelCands.push(cand)
  }
  if (alreadyLabels) notes.push(`既存ラベル（名前・同義語）と同じだった ${alreadyLabels} 件はラベル候補から外しました。`)
  if (nodeLike) notes.push(`ラベルではなくノード（個体）と判断した ${nodeLike} 件はラベル候補から外しました。`)

  // 始点・終点の名前 → 既存ラベルかラベル候補
  const refOf = (name: string): LabelRef | null => {
    const existing = labelByTerm(labels, name)
    if (existing) return { kind: "label", id: existing.id }
    const cand = seenLabel.get(normalizeName(name))
    return cand ? { kind: "candidate", id: cand.id } : null
  }

  // ── リレーションシップタイプ候補 ──
  const typeCands: RelTypeCandidate[] = []
  const seenType = new Set<string>()
  let alreadyTypes = 0
  let inverse = 0
  for (const raw of raws) for (const t of raw.relationshipTypes ?? []) {
    const name = t.name.trim()
    if (!normalizeName(name)) continue
    // 既存タイプの向きを入れ替えただけのものは出さない（既存タイプで A・B を入れ替えて表せる）
    if (t.inverseOfExistingType?.trim()) { inverse++; continue }
    const source = refOf(t.sourceLabel)
    const target = refOf(t.targetLabel)
    const sameName = typeByName(relTypes, name)
    // 同じ名前の既存タイプに、同じ始点・終点のペアがもうあれば登録済み
    if (sameName && source?.kind === "label" && target?.kind === "label" &&
      (sameName.labelPairs ?? []).some((p) => p.sourceLabelId === source.id && p.targetLabelId === target.id)) {
      alreadyTypes++
      continue
    }
    const key = `${normalizeName(name)}|${normalizeName(t.sourceLabel)}|${normalizeName(t.targetLabel)}`
    if (seenType.has(key)) continue
    seenType.add(key)
    const aiSimilar = t.similarExistingType ? typeByName(relTypes, t.similarExistingType) : undefined
    // LLM が挙げなくても、同じラベルどうし（逆向きも含む）を結ぶ既存タイプは近いものとして出す
    const samePair = source?.kind === "label" && target?.kind === "label"
      ? relTypes.find((x) => (x.labelPairs ?? []).some((p) =>
          (p.sourceLabelId === source.id && p.targetLabelId === target.id) ||
          (p.sourceLabelId === target.id && p.targetLabelId === source.id)))
      : undefined
    const similar = sameName ?? aiSimilar ?? samePair
    typeCands.push({
      id: newId(), status: "pending", name, description: t.description ?? "", evidence: t.evidence ?? "",
      source, target, sourceName: t.sourceLabel, targetName: t.targetLabel,
      similarTypeId: similar?.id ?? null,
      similarReason: sameName ? "同じ名前の既存タイプ"
        : aiSimilar ? (t.similarReason || "AIの判断：同じ意味の可能性")
        : samePair ? "同じラベルどうしを結ぶ既存タイプ" : "",
    })
  }
  // LLM が申告しなかった言い換えも外す。抽出とは別に、候補と既存タイプを並べて
  // 「能動／受動・向きの入れ替えだけの言い換え」かどうかを確かめさせる（両方の向きを持たせない）
  if (typeCands.length > 0) {
    const drop = await findInverseParaphrases(typeCands, ctx)
    if (drop.size > 0) {
      inverse += drop.size
      const kept = typeCands.filter((c) => !drop.has(c.id))
      typeCands.length = 0
      typeCands.push(...kept)
    }
  }

  if (alreadyTypes) notes.push(`既存タイプと同じ名前・同じ始点終点だった ${alreadyTypes} 件はタイプ候補から外しました。`)
  if (inverse) notes.push(`既存タイプや他の候補の向きを入れ替えただけ（能動／受動の言い換え）の ${inverse} 件はタイプ候補から外しました。`)

  return { labels: labelCands, relTypes: typeCands, notes }
}

// 能動／受動・向きの入れ替えだけの言い換えになっているタイプ候補を見つける。
// 理由（両方の向きを登録してはいけない）は SCHEMA_SYSTEM の【絶対の禁止】と同じ。
const INVERSE_CHECK_SYSTEM = [
  "あなたはナレッジグラフのスキーマを点検します。リレーションシップタイプは、1つの関係を1つの向きのタイプだけで表します。",
  "能動と受動、または始点と終点を入れ替えただけの言い換え（例：「AはBを愛している」と「AはBに愛されている」、「AはBを構成部品に持つ」と「AはBの構成部品である」）を両方登録すると、片方だけ消したときにデータが矛盾し、リレーションシップが2倍になり、LLM が Cypher を作るときにどちらを使うか迷う。だから言い換えは必ず除く。",
  "",
  "【候補】それぞれについて、【既存タイプ】のどれか、または番号の小さいほかの【候補】の、能動／受動・向きの入れ替えだけの言い換えになっていないかを判定してください。",
  "- 言い換えなら paraphraseOf にその既存タイプ名か候補番号（例：「候補2」）を書きます。言い換えでなければ空文字にします。",
  "- 候補どうしが言い換えのときは、能動の向きのほうを残し、受動・逆向きのほうに paraphraseOf を書きます。",
  "- 意味が違う関係（例：「AはBを加工する」と「AはBで作られる」）は言い換えではありません。始点・終点のラベルの向きも見て判断してください。",
].join("\n")

const INVERSE_CHECK_FORMAT = {
  type: "object",
  additionalProperties: false,
  required: ["results"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["candidate", "paraphraseOf", "reason"],
        properties: {
          candidate: { type: "integer" },
          paraphraseOf: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
  },
}

async function findInverseParaphrases(cands: RelTypeCandidate[], ctx: SchemaContext): Promise<Set<string>> {
  const labelName = new Map(ctx.labels.map((l) => [l.id, l.name]))
  // ラベル候補を指す始点・終点は、LLM が挙げた名前で見せる
  const refName = (ref: LabelRef | null, fallback: string) =>
    ref?.kind === "label" ? labelName.get(ref.id) ?? fallback : fallback
  const existing = ctx.relTypes.map((t) => {
    const pairs = (t.labelPairs ?? []).map((p) => `${labelName.get(p.sourceLabelId) ?? "?"}→${labelName.get(p.targetLabelId) ?? "?"}`)
    return `- ${t.name}（${pairs.join("、") || "ペアなし"}）`
  }).join("\n") || "（なし）"
  const list = cands.map((c, i) =>
    `候補${i + 1}：${c.name}（${refName(c.source, c.sourceName)}→${refName(c.target, c.targetName)}）`).join("\n")
  const raw = await callStructured<{ results: { candidate: number; paraphraseOf: string; reason: string }[] }>(
    INVERSE_CHECK_SYSTEM, `【既存タイプ】\n${existing}\n\n【候補】\n${list}`, INVERSE_CHECK_FORMAT)
  const drop = new Set<string>()
  for (const r of raw.results ?? []) {
    const c = cands[r.candidate - 1]
    if (c && r.paraphraseOf?.trim()) drop.add(c.id)
  }
  return drop
}

// ───────────────────────── グラフデータ抽出 ─────────────────────────

const GRAPH_SYSTEM = [
  "あなたはナレッジグラフの作成者です。文書を読み、決められたスキーマ（既存ラベル・既存リレーションシップタイプ）だけを使って、ノードとリレーションシップの候補を挙げます。スキーマにないラベルやタイプは使ってはいけません。",
  "",
  GRAPH_SCOPE_GUIDE,
  "",
  "ノード：",
  "- 文書に出てくる個々の具体物（型番・図番・固有名詞・個別の事例など）をノードとして挙げます。",
  "- labels には、そのノードに当てはまる既存ラベル名を挙げます（複数可）。既存ノードのラベルの付け方を参考にしてください。",
  "- name は【既存ノード】の名前の付け方（表記・区切り記号・型番の書式・全角半角）に揃えた名前にします。sourceText には文書中での元の表記をそのまま書きます。",
  "- 既存ノードとまったく同じもの（同じ名前・同じラベル）は挙げないでください。",
  "- 既存ノードと同じものかもしれない別表記は、similarExistingNode にその既存ノード名、similarReason に理由を書いて挙げます。なければ空文字にします。",
  "- properties には、そのラベルのプロパティのうち、文書に値が書かれているものだけを入れます。",
  "",
  "リレーションシップ：",
  "- 文書にはっきり書かれている事実だけを、始点ノード・タイプ・終点ノードの形で挙げます。推測で補いません。",
  "- startNode・endNode は、既存ノード名か、この回答で挙げたノード候補の name にします。",
  "- relationshipType は既存リレーションシップタイプの名前をそのまま使います。そのタイプのラベルペア（始点ラベル→終点ラベル）に合う組み合わせだけを挙げます。",
  "- 既存のリレーションシップと同じものは挙げないでください。",
  "",
  "evidence には根拠となる原文を短く抜き出してください。",
].join("\n")

const GRAPH_FORMAT = {
  type: "object",
  additionalProperties: false,
  required: ["nodes", "relationships"],
  properties: {
    nodes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "sourceText", "labels", "properties", "evidence", "similarExistingNode", "similarReason"],
        properties: {
          name: { type: "string" },
          sourceText: { type: "string" },
          labels: { type: "array", items: { type: "string" } },
          properties: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["key", "value"],
              properties: { key: { type: "string" }, value: { type: "string" } },
            },
          },
          evidence: { type: "string" },
          similarExistingNode: { type: "string" },
          similarReason: { type: "string" },
        },
      },
    },
    relationships: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["startNode", "relationshipType", "endNode", "evidence"],
        properties: {
          startNode: { type: "string" },
          relationshipType: { type: "string" },
          endNode: { type: "string" },
          evidence: { type: "string" },
        },
      },
    },
  },
}

type GraphRaw = {
  nodes: {
    name: string; sourceText: string; labels: string[]; properties: { key: string; value: string }[]
    evidence: string; similarExistingNode: string; similarReason: string
  }[]
  relationships: { startNode: string; relationshipType: string; endNode: string; evidence: string }[]
}

// 既存ノードの一覧は、名前の付け方の手本として渡す。多すぎるときはラベルごとに均して間引く。
const NODE_SAMPLE_LIMIT = 1500

function graphContextText(ctx: GraphContext): string {
  const { labels, relTypes, nodes, propertyDefs } = ctx
  const labelName = new Map(labels.map((l) => [l.id, l.name]))
  const labelText = labels.filter((l) => !l.system).map((l) => {
    const keys = propertyDefs.filter((d) => d.targetType === "label" && d.targetId === l.id).map((d) => d.name)
    return `- ${l.name}${l.synonyms?.length ? `（同義語: ${l.synonyms.join("、")}）` : ""}${keys.length ? `　プロパティ: ${keys.join("、")}` : ""}`
  }).join("\n") || "（なし）"
  const typeText = relTypes.map((t) => {
    const pairs = (t.labelPairs ?? []).map((p) => `${labelName.get(p.sourceLabelId) ?? "?"}→${labelName.get(p.targetLabelId) ?? "?"}`)
    return `- ${t.name}（${pairs.join("、") || "ペアなし"}）`
  }).join("\n") || "（なし）"
  const live = nodes.filter((n) => n.status !== "merged")
  const sample = live.length > NODE_SAMPLE_LIMIT ? live.filter((_, i) => i % Math.ceil(live.length / NODE_SAMPLE_LIMIT) === 0) : live
  const nodeText = sample.map((n) =>
    `- ${n.name}［${(n.labelIds ?? []).map((id) => labelName.get(id) ?? "?").join("・") || "ラベルなし"}］${n.aliases?.length ? `（別名: ${n.aliases.join("、")}）` : ""}`,
  ).join("\n") || "（なし）"
  const projectKeys = propertyDefs.filter((d) => d.targetType === "project").map((d) => d.name)
  return `【既存ラベル】\n${labelText}${projectKeys.length ? `\n（全ノード共通のプロパティ: ${projectKeys.join("、")}）` : ""}\n\n` +
    `【既存リレーションシップタイプ】（名前と、始点→終点のラベルペア）\n${typeText}\n\n` +
    `【既存ノード】${sample.length < live.length ? `（${live.length}件のうち${sample.length}件）` : ""}\n${nodeText}`
}

export async function extractGraph(
  text: string,
  ctx: GraphContext,
): Promise<{ nodes: NodeCandidate[]; relationships: RelationshipCandidate[]; notes: string[] }> {
  const { labels, relTypes, nodes, relationships, propertyDefs } = ctx
  if (relTypes.length === 0 || labels.filter((l) => !l.system).length === 0) {
    return { nodes: [], relationships: [], notes: ["ラベルとリレーションシップタイプが登録されていないため、グラフデータは抽出できません。"] }
  }
  const chunks = splitText(text)
  const context = graphContextText(ctx)
  const raws = await mapChunks(chunks, (chunk, i) =>
    callStructured<GraphRaw>(GRAPH_SYSTEM, `${context}\n\n【文書】${partLabel(i, chunks.length)}\n${chunk}`, GRAPH_FORMAT))

  const notes: string[] = []
  const allowedKeys = (labelIds: string[]) => new Set(propertyDefs
    .filter((d) => d.targetType === "project" || (d.targetType === "label" && labelIds.includes(d.targetId)))
    .map((d) => d.name))

  // ── ノード候補 ──
  const nodeCands: NodeCandidate[] = []
  const byKey = new Map<string, NodeCandidate>()
  const byName = new Map<string, NodeCandidate>()
  let alreadyNodes = 0
  for (const raw of raws) for (const n of raw.nodes ?? []) {
    const name = n.name.trim()
    const key = normalizeName(name)
    if (!key) continue
    const labelIds = [...new Set((n.labels ?? []).map((t) => labelByTerm(labels, t)).filter((l): l is Label => !!l && !l.system).map((l) => l.id))]
    const sameName = liveNodeByName(nodes, name)
    // 同じ名前・同じラベルの既存ノードがあれば登録済み
    if (sameName.some((x) => sameSet(x.labelIds ?? [], labelIds))) { alreadyNodes++; continue }
    const setKey = `${key}|${[...labelIds].sort().join(",")}`
    const keys = allowedKeys(labelIds)
    const props: Record<string, string> = {}
    for (const p of n.properties ?? []) if (keys.has(p.key) && p.value.trim()) props[p.key] = p.value.trim()
    const dup = byKey.get(setKey)
    if (dup) { dup.properties = { ...props, ...dup.properties }; continue }
    const aiSimilar = n.similarExistingNode ? liveNodeByName(nodes, n.similarExistingNode)[0] : undefined
    const similar = sameName[0] ?? aiSimilar
    const cand: NodeCandidate = {
      id: newId(), status: "pending", name, sourceText: n.sourceText ?? "", labelIds, properties: props,
      evidence: n.evidence ?? "",
      similarNodeId: similar?.id ?? null,
      similarReason: sameName[0] ? "同じ名前で別のラベル" : aiSimilar ? (n.similarReason || "AIの判断：同じものの可能性") : "",
    }
    byKey.set(setKey, cand)
    if (!byName.has(key)) byName.set(key, cand)
    nodeCands.push(cand)
  }
  if (alreadyNodes) notes.push(`既存ノードと同じ名前・同じラベルだった ${alreadyNodes} 件はノード候補から外しました。`)

  // 名前 → 既存ノードかノード候補
  const refOf = (name: string): NodeRef | null => {
    const existing = liveNodeByName(nodes, name)[0]
    if (existing) return { kind: "node", id: existing.id }
    const cand = byName.get(normalizeName(name))
    return cand ? { kind: "candidate", id: cand.id } : null
  }

  // ── リレーションシップ候補 ──
  const existingKeys = new Set(relationships.map((r) => `${r.startNodeId}|${r.relTypeId}|${r.endNodeId}`))
  const relCands: RelationshipCandidate[] = []
  const seen = new Set<string>()
  let unresolved = 0
  let alreadyRels = 0
  for (const raw of raws) for (const r of raw.relationships ?? []) {
    const type = typeByName(relTypes, r.relationshipType)
    const start = refOf(r.startNode)
    const end = refOf(r.endNode)
    if (!type || !start || !end) { unresolved++; continue }
    const key = `${start.kind}:${start.id}|${type.id}|${end.kind}:${end.id}`
    if (seen.has(key)) continue
    seen.add(key)
    if (start.kind === "node" && end.kind === "node" && existingKeys.has(`${start.id}|${type.id}|${end.id}`)) { alreadyRels++; continue }
    relCands.push({ id: newId(), status: "pending", start, relTypeId: type.id, end, evidence: r.evidence ?? "" })
  }
  if (alreadyRels) notes.push(`既存と同じリレーションシップ ${alreadyRels} 件は候補から外しました。`)
  if (unresolved) notes.push(`始点・終点のノードかタイプがスキーマ・候補に見つからなかった ${unresolved} 件は候補から外しました。`)

  return { nodes: nodeCands, relationships: relCands, notes }
}
