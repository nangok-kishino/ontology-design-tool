// 共通取込みエンジン：ファイル→テキスト抽出、LLM ツールコール（Anthropic / Gemini 切替）、
// および「オントロジー抽出」と「トリプレット抽出」の両方。
//
// 【本アプリの本質・手順は固定】オントロジー設計が主、トリプレットは従属。
// 1回の取込みで、まずオントロジー設計の材料（クラス／リレーション／インスタンス候補）を抽出し、
// トリプレットは「登録済み（本登録）インスタンス＋定義済みリレーション」に基づく分だけ従属的に抽出する。
// どちらの文書取込みメニューから取り込んでも両方を抽出し、両画面（全体＝オントロジー側／
// ナレッジグラフ作成側）に反映する。

import Anthropic from "@anthropic-ai/sdk"
import type { OntologyClass, OntologyInstance, OntologyRelation } from "./types"
import { relationAllowsPair } from "./triplet-resolve"

export async function extractTextFromFile(file: File): Promise<string> {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  if (isPdf) {
    const { default: pdfParse } = await import("pdf-parse")
    const buffer = Buffer.from(await file.arrayBuffer())
    const data = await pdfParse(buffer)
    return data.text
  }
  return await file.text()
}

export type ToolFunction = {
  name: string
  description: string
  parameters: Record<string, unknown>
}

async function callAnthropicTool(model: string, system: string, userContent: string, fn: ToolFunction) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const msg = await anthropic.messages.create({
    model,
    max_tokens: 8192,
    system,
    tools: [{ name: fn.name, description: fn.description, input_schema: fn.parameters as any }],
    tool_choice: { type: "tool", name: fn.name },
    messages: [{ role: "user", content: userContent }],
  })
  const toolUse = msg.content.find((b) => b.type === "tool_use")
  if (!toolUse || toolUse.type !== "tool_use") throw new Error("解析結果を取得できませんでした（Claude）")
  return toolUse.input as any
}

async function callGeminiTool(model: string, system: string, userContent: string, fn: ToolFunction) {
  const apiKey = process.env.GEMINI_API_KEY
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: userContent }] }],
        tools: [{ function_declarations: [fn] }],
        tool_config: { function_calling_config: { mode: "ANY", allowed_function_names: [fn.name] } },
      }),
    },
  )
  if (!res.ok) throw new Error(`Gemini API error ${res.status}: ${await res.text()}`)
  const json = await res.json()
  const part = (json.candidates?.[0]?.content?.parts ?? []).find((p: any) => p.functionCall)
  if (!part?.functionCall) throw new Error("解析結果を取得できませんでした（Gemini）")
  return part.functionCall.args
}

// モデルIDでプロバイダーを振り分けてツールコールを実行し、抽出結果（tool入力）を返す。
export async function runExtraction(model: string, system: string, userContent: string, fn: ToolFunction) {
  return model.startsWith("claude-")
    ? callAnthropicTool(model, system, userContent, fn)
    : callGeminiTool(model, system, userContent, fn)
}

// ───────────────────────── オントロジー抽出 ─────────────────────────

const ONTOLOGY_SYSTEM =
  "あなたはオントロジーエンジニアです。提供された文書と定義済みクラス・リレーション・登録済みインスタンスを参照し、以下を抽出してください。\n\n" +
  "1. インスタンス候補：文書中の具体的な事例・対象・固有名詞のうち、【登録済みインスタンス】に一致・類似するものは除外し、新規性のあるものだけを列挙してください。既存クラスに割り当ててください（suggestedClassId と suggestedClassName を指定）。適切なクラスがない場合は isNewClass: true とし、新規クラス名と説明を提案してください。\n\n" +
  "2. リレーション候補：クラス（種類・カテゴリ）どうしの関係を、汎用的で再利用可能な粒度で抽出してください。\n" +
  "   - リレーション名は「始点クラス（主語）—述語—終点クラス（目的語）」の【述語部分だけ】を記述してください。主語となる始点クラスや、目的語となる終点クラスの名詞をリレーション名に含めてはいけません（それらは sourceClassName／targetClassName で別途表します）。\n" +
  "   - リレーション名は簡潔な動詞句にしてください。良い例：「含む」「構成する」「搭載される」「評価される」「準拠する」「影響する」（格助詞を付けた「を含む」「に搭載される」なども可）。悪い例：「潤滑油の低粘度化が燃費・電費を向上させる」（主語・目的語・条件を含む）／「性能に影響する」（目的語の名詞『性能』を含む）。\n" +
  "   - 特定の指標・数値・条件・形容表現を埋め込んだ文章的で過度に具体的な関係は避け、そのクラスの多くのインスタンスに一般的に当てはまる述語へ一般化してください。似た関係は無理に細分化せず1つにまとめてください。\n" +
  "   - 始点・終点にはできる限り【定義済みクラス】を割り当て（sourceClassId／targetClassId にIDを指定）、該当する既存クラスが無い場合のみ新規クラス名を sourceClassName／targetClassName に記載してください。\n" +
  "   - 【定義済みリレーション】と同一の組み合わせ（始点・終点・意味が一致）や、候補どうしで重複するものは除外し、必ず一意にしてください。"

const ONTOLOGY_FUNCTION: ToolFunction = {
  name: "extract_ontology_candidates",
  description: "文書からインスタンス候補と新規リレーション候補を抽出する",
  parameters: {
    type: "object",
    properties: {
      instances: {
        type: "array",
        description: "文書中の具体的なインスタンス候補（特定の事例・対象・固有名詞）",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "インスタンス候補名" },
            suggestedClassId: { type: "string", description: "割当先の既存クラスID（なければ空文字）" },
            suggestedClassName: { type: "string", description: "割当先クラス名（既存または新規提案名）" },
            isNewClass: { type: "boolean", description: "適切な既存クラスがなく新規クラス作成が必要ならtrue" },
            newClassName: { type: "string", description: "新規クラス名（isNewClass=trueの場合）" },
            newClassDescription: { type: "string", description: "新規クラスの説明（isNewClass=trueの場合、1〜2文）" },
          },
          required: ["name", "suggestedClassName", "isNewClass"],
        },
      },
      relations: {
        type: "array",
        description: "既存リレーションに含まれない新たなクラス間関係の候補",
        items: {
          type: "object",
          properties: {
            sourceClassId: { type: "string", description: "始点クラスのID（既存クラスから。不明なら空文字）" },
            sourceClassName: { type: "string", description: "始点クラス名" },
            relationName: { type: "string", description: "リレーション名（述語部分のみの動詞句。始点クラス＝主語や終点クラス＝目的語の名詞は含めない。例：含む／搭載される／影響する）" },
            targetClassId: { type: "string", description: "終点クラスのID（既存クラスから。不明なら空文字）" },
            targetClassName: { type: "string", description: "終点クラス名" },
            description: { type: "string", description: "リレーションの説明（1〜2文）" },
          },
          required: ["sourceClassName", "relationName", "targetClassName", "description"],
        },
      },
    },
    required: ["instances", "relations"],
  },
}

export type OntologyInstanceCandidate = {
  id: string
  name: string
  classId: string | null
  className: string
  isNewClass: boolean
  newClassName: string
  newClassDescription: string
  status: "確認中"
  saving: boolean
}
export type OntologyRelationCandidate = {
  id: string
  sourceClassId: string | null
  sourceClassName: string
  relationName: string
  targetClassId: string | null
  targetClassName: string
  description: string
  status: "確認中"
  saving: boolean
}
export type OntologyResult = { instances: OntologyInstanceCandidate[]; relations: OntologyRelationCandidate[] }

// 文書からオントロジー候補（インスタンス／リレーション）を抽出する。
// 返り値は review-screen がそのまま扱えるクライアント候補形。
export async function extractOntology(
  model: string,
  text: string,
  ctx: { classes: OntologyClass[]; relations: OntologyRelation[]; instances: OntologyInstance[] },
): Promise<OntologyResult> {
  const { classes, relations, instances } = ctx
  const classIdMap = new Map<string, string>(classes.map((c) => [c.id, c.name]))
  const validClassIds = new Set<string>(classes.map((c) => c.id))

  const classListText = classes.length > 0
    ? classes.map((c) => `- ID: ${c.id}, 名前: ${c.name}${c.nameEn ? ` (${c.nameEn})` : ""}, 説明: ${c.description || "なし"}`).join("\n")
    : "（定義済みクラスなし）"
  const relListText = relations.length > 0
    ? relations.map((r) => {
        const pairsText = ((r.classPairs ?? []) as any[]).map((p) => `${classIdMap.get(p.sourceClassId) ?? p.sourceClassId} → ${classIdMap.get(p.targetClassId) ?? p.targetClassId}`).join(", ")
        return `- 名前: ${r.name}${r.nameEn ? ` (${r.nameEn})` : ""}, ペア: ${pairsText}`
      }).join("\n")
    : "（定義済みリレーションなし）"
  const instanceListText = instances.length > 0
    ? instances.map((i) => `- ID: ${i.id}, 名前: ${i.name}, クラス: ${classIdMap.get(i.classId ?? "") ?? "未分類"}`).join("\n")
    : "（登録済みインスタンスなし）"

  const userContent =
    `【定義済みクラス】\n${classListText}\n\n` +
    `【定義済みリレーション】（これらと重複しない候補のみ提案してください）\n${relListText}\n\n` +
    `【登録済みインスタンス】（これらと同一・類似のものは候補に含めないでください）\n${instanceListText}\n\n` +
    `【文書】\n${text.slice(0, 12000)}`

  const raw = await runExtraction(model, ONTOLOGY_SYSTEM, userContent, ONTOLOGY_FUNCTION)
  const result = raw as {
    instances: Array<{ name: string; suggestedClassId?: string; suggestedClassName: string; isNewClass: boolean; newClassName?: string; newClassDescription?: string }>
    relations: Array<{ sourceClassId?: string; sourceClassName: string; relationName: string; targetClassId?: string; targetClassName: string; description: string }>
  }
  const now = Date.now()

  const outInstances: OntologyInstanceCandidate[] = (result.instances ?? []).map((inst, i) => {
    let classId: string | null = null
    let className = ""
    if (inst.suggestedClassId && validClassIds.has(inst.suggestedClassId)) {
      classId = inst.suggestedClassId
      className = classIdMap.get(classId) ?? ""
    } else if (!inst.isNewClass) {
      const matchByName = classes.find((c) => c.name === inst.suggestedClassName)
      if (matchByName) { classId = matchByName.id; className = matchByName.name }
    }
    return {
      id: `ic-${now}-${i}`,
      name: inst.name,
      classId,
      className,
      isNewClass: inst.isNewClass || !classId,
      newClassName: inst.newClassName ?? (inst.isNewClass ? inst.suggestedClassName : ""),
      newClassDescription: inst.newClassDescription ?? "",
      status: "確認中",
      saving: false,
    }
  })

  const outRelations: OntologyRelationCandidate[] = (result.relations ?? []).map((rel, i) => {
    const srcId = rel.sourceClassId && validClassIds.has(rel.sourceClassId) ? rel.sourceClassId : null
    const tgtId = rel.targetClassId && validClassIds.has(rel.targetClassId) ? rel.targetClassId : null
    const srcByName = !srcId ? classes.find((c) => c.name === rel.sourceClassName) : null
    const tgtByName = !tgtId ? classes.find((c) => c.name === rel.targetClassName) : null
    const resolvedSrcId = srcId ?? srcByName?.id ?? null
    const resolvedTgtId = tgtId ?? tgtByName?.id ?? null
    return {
      id: `rc-${now}-${i}`,
      sourceClassId: resolvedSrcId,
      sourceClassName: resolvedSrcId ? (classIdMap.get(resolvedSrcId) ?? rel.sourceClassName) : rel.sourceClassName,
      relationName: rel.relationName,
      targetClassId: resolvedTgtId,
      targetClassName: resolvedTgtId ? (classIdMap.get(resolvedTgtId) ?? rel.targetClassName) : rel.targetClassName,
      description: rel.description,
      status: "確認中",
      saving: false,
    }
  })

  return { instances: outInstances, relations: outRelations }
}

// ───────────────────────── トリプレット抽出（オントロジー従属） ─────────────────────────

const TRIPLET_SYSTEM =
  "あなたはナレッジグラフのエンジニアです。与えられた【登録済みインスタンス】と【定義済みリレーション】だけを使って、文書に明確に書かれている事実をトリプレット (主語)-(述語)-(目的語) として抽出します。\n\n" +
  "厳守事項：\n" +
  "1. 主語・目的語は必ず【登録済みインスタンス】の中から選び、その id を返す。リストに無い事物は主語・目的語にしてはいけない。\n" +
  "2. 述語は必ず【定義済みリレーション】の中から選び、その id を返す。リストに無い関係は使ってはいけない。\n" +
  "3. リレーションには許可されたクラスペア（始点クラス→終点クラス）がある。主語インスタンスのクラスと目的語インスタンスのクラスが、その述語の許可ペアに一致する組み合わせだけを抽出する。\n" +
  "4. 文書に、登録済みインスタンス同士が定義済みリレーションで結ばれる事実が明確に書かれていない場合は、何も出力しない（推測で補完しない）。\n" +
  "5. 各トリプレットには、根拠となった原文の短いスニペットを evidence に入れる。\n\n" +
  "id は必ずリストに記載のものをそのままコピーして使うこと。"

const TRIPLET_FUNCTION: ToolFunction = {
  name: "extract_triplets",
  description: "登録済みインスタンスと定義済みリレーションだけを使って、文書からトリプレットを抽出する",
  parameters: {
    type: "object",
    properties: {
      triplets: {
        type: "array",
        description: "登録済みインスタンス同士が定義済みリレーションで結ばれる、文書中の事実",
        items: {
          type: "object",
          properties: {
            subjectInstanceId: { type: "string", description: "主語：【登録済みインスタンス】の id をそのまま指定" },
            predicateRelationId: { type: "string", description: "述語：【定義済みリレーション】の id をそのまま指定" },
            objectInstanceId: { type: "string", description: "目的語：【登録済みインスタンス】の id をそのまま指定" },
            evidence: { type: "string", description: "根拠となる原文の短いスニペット" },
            confidence: { type: "number", description: "確信度 0〜1" },
          },
          required: ["subjectInstanceId", "predicateRelationId", "objectInstanceId"],
        },
      },
    },
    required: ["triplets"],
  },
}

export type ExtractedTriplet = {
  subjectInstanceId: string
  predicateRelationId: string
  objectInstanceId: string
  subjectName: string
  predicateName: string
  objectName: string
  evidence: string
  confidence?: number
}

// 文書からトリプレットを抽出する。登録済みインスタンス／定義済みリレーションの id の中から
// 選ばせ、サーバ側でも id の実在を検証して、リスト外（ハルシネーション）は破棄する。
// 前提（本登録インスタンス・定義済みリレーション）が無ければ何も抽出しない。
export async function extractTriplets(
  model: string,
  text: string,
  ctx: { confirmedInstances: OntologyInstance[]; relations: OntologyRelation[]; classNameById: Map<string, string> },
): Promise<{ triplets: ExtractedTriplet[]; dropped: number }> {
  const { confirmedInstances, relations, classNameById } = ctx
  if (confirmedInstances.length === 0 || relations.length === 0) return { triplets: [], dropped: 0 }

  const instById = new Map(confirmedInstances.map((i) => [i.id, i]))
  const relById = new Map(relations.map((r) => [r.id, r]))

  const instText = confirmedInstances
    .map((i) => `- id=${i.id} 名前=${i.name} クラス=${i.classId ? (classNameById.get(i.classId) ?? "不明") : "未分類"}`)
    .join("\n")
  const relText = relations
    .map((r) => {
      const pairs = (r.classPairs ?? []).map((p) => `${classNameById.get(p.sourceClassId) ?? "?"}→${classNameById.get(p.targetClassId) ?? "?"}`).join(", ")
      return `- id=${r.id} 名前=${r.name} 許可ペア=[${pairs || "未定義"}]`
    })
    .join("\n")

  const userContent =
    `【登録済みインスタンス】（主語・目的語はこの中から id で選ぶ）\n${instText}\n\n` +
    `【定義済みリレーション】（述語はこの中から id で選ぶ。許可ペアに一致する組み合わせのみ）\n${relText}\n\n` +
    `【文書】\n${text.slice(0, 12000)}`

  const raw = await runExtraction(model, TRIPLET_SYSTEM, userContent, TRIPLET_FUNCTION)
  const result = raw as { triplets: Array<{ subjectInstanceId: string; predicateRelationId: string; objectInstanceId: string; evidence?: string; confidence?: number }> }

  const out: ExtractedTriplet[] = []
  let dropped = 0
  for (const t of result.triplets ?? []) {
    const subject = instById.get(t.subjectInstanceId)
    const relation = relById.get(t.predicateRelationId)
    const object = instById.get(t.objectInstanceId)
    // リストに無いid、または許可クラスペアに適合しない組み合わせは候補にしない
    // （定義済みオントロジーに適合するものだけを抽出する＝本質）
    if (!subject || !relation || !object) { dropped++; continue }
    if (!relationAllowsPair(relation, subject.classId, object.classId)) { dropped++; continue }
    out.push({
      subjectInstanceId: subject.id,
      predicateRelationId: relation.id,
      objectInstanceId: object.id,
      subjectName: subject.name,
      predicateName: relation.name,
      objectName: object.name,
      evidence: t.evidence?.trim() ?? "",
      confidence: typeof t.confidence === "number" ? t.confidence : undefined,
    })
  }
  return { triplets: out, dropped }
}
