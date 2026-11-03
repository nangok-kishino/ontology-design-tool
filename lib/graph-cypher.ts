// Neo4j へ渡すための Cypher 生成と、その前のチェック。
//
// このアプリの役目は「Neo4j に登録する前に、きれいに・正しくグラフを作る」ところまで。
// できあがったグラフの探索・可視化は Neo4j 側に任せる（docs/graph-model.md §1）。
//
// 出力の形:
//   ノード            = (:Node) ＋ 付与されたラベルを Neo4j のラベルとして付ける
//   リレーションシップ = タイプ名をそのまま関係タイプにする
// すべて MERGE で出すので、何度流し込んでも id 一致で重複しない。

import { formatTripletConditions } from "./relation-conditions"
import { conditionSetsOf, relTypeAllows } from "./graph-types"
import type { GraphNode, Label, PropertyDef, Relationship, RelationshipType } from "./graph-types"

function escLabel(s: string): string {
  return "`" + s.replace(/`/g, "``") + "`"
}
function escStr(s: string): string {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'
}

export type GraphData = {
  labels: Label[]
  relTypes: RelationshipType[]
  nodes: GraphNode[]
  relationships: Relationship[]
  propertyDefs: PropertyDef[]
}

// ─────────────────────────────────────────────
// エクスポート前チェック
// ─────────────────────────────────────────────
export type CheckKey =
  | "orphanNodes"
  | "schemaMismatch"
  | "unusedLabels"
  | "unusedRelTypes"
  | "missingRequired"
  | "unchecked"

export type CheckItem = {
  // 画面から辿れるように、対象の id と表示名を持つ
  id: string
  name: string
  detail?: string
}

export type CheckResult = {
  key: CheckKey
  // export : Neo4j に入るデータの質に関わるもの（エクスポート前に見るべきもの）
  // schema : 定義したがまだ使っていないもの。出力には現れないので、エクスポートには影響しない
  category: "export" | "schema"
  title: string
  description: string
  // 直さなくても出力はできるか（false＝出力を止めるほどではない）
  blocking: boolean
  items: CheckItem[]
}

export function runChecks(data: GraphData): CheckResult[] {
  const { labels, relTypes, nodes, relationships, propertyDefs } = data
  const labelById = new Map(labels.map((l) => [l.id, l]))
  const typeById = new Map(relTypes.map((t) => [t.id, t]))
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const liveNodes = nodes.filter((n) => n.status !== "merged")
  const categoryLabelIds = new Set(labels.filter((l) => l.system === "category").map((l) => l.id))
  const isCategory = (n: GraphNode) => (n.labelIds ?? []).some((id) => categoryLabelIds.has(id))
  const labelName = (id: string) => labelById.get(id)?.name ?? "（削除済み）"

  // 1. 孤立ノード（どのリレーションシップにも現れない）。カテゴリノードは除く。
  const used = new Set<string>()
  for (const r of relationships) { used.add(r.startNodeId); used.add(r.endNodeId) }
  const orphanNodes = liveNodes
    .filter((n) => !isCategory(n) && !used.has(n.id))
    .map((n) => ({
      id: n.id,
      name: n.name,
      detail: (n.labelIds ?? []).map(labelName).join("、") || "ラベルなし",
    }))

  // 2. スキーマに無い組み合わせ
  const labelsOf = (nodeId: string, snapshot: string[] | undefined) =>
    nodeById.get(nodeId)?.labelIds ?? snapshot ?? []
  const schemaMismatch = relationships
    .filter((r) => {
      const t = typeById.get(r.relTypeId)
      if (!t) return true
      return !relTypeAllows(t, labelsOf(r.startNodeId, r.startNodeLabelIds), labelsOf(r.endNodeId, r.endNodeLabelIds))
    })
    .map((r) => ({
      id: r.id,
      name: `${r.startNodeName} → ${r.relTypeName} → ${r.endNodeName}`,
      detail: `${labelsOf(r.startNodeId, r.startNodeLabelIds).map(labelName).join("、") || "ラベルなし"}`
        + ` → ${labelsOf(r.endNodeId, r.endNodeLabelIds).map(labelName).join("、") || "ラベルなし"}`,
    }))

  // 3. 使われていないラベル（ノードにも付いておらず、ラベルペアにも出てこない）。予約ラベルは除く。
  const labelUsedByNode = new Set(liveNodes.flatMap((n) => n.labelIds ?? []))
  const labelUsedByPair = new Set(
    relTypes.flatMap((t) => (t.labelPairs ?? []).flatMap((p) => [p.sourceLabelId, p.targetLabelId])),
  )
  // ノードが1件も付いていないラベル。ラベルペアに出てくるかどうかは補足として添える
  // （ペアに出てくるものはスキーマ上は使っているので、データがまだ無いだけ）。
  const unusedLabels = labels
    .filter((l) => !l.system && !labelUsedByNode.has(l.id))
    .map((l) => ({
      id: l.id,
      name: l.name,
      detail: labelUsedByPair.has(l.id) ? "ラベルペアには登場" : "ラベルペアにも登場しない",
    }))

  // 4. 使われていないリレーションシップタイプ
  const typeUsed = new Set(relationships.map((r) => r.relTypeId))
  const unusedRelTypes = relTypes
    .filter((t) => !typeUsed.has(t.id))
    .map((t) => ({ id: t.id, name: t.name }))

  // 5. 必須プロパティが空のノード（付与ラベル＋プロジェクト共通で必須のもの）
  const missingRequired: CheckItem[] = []
  for (const n of liveNodes) {
    const required = propertyDefs.filter(
      (p) =>
        p.required === "必須" &&
        (p.targetType === "project" || (p.targetType === "label" && (n.labelIds ?? []).includes(p.targetId))),
    )
    const empty = required.filter((p) => !(n.properties?.[p.name] ?? "").trim()).map((p) => p.name)
    if (empty.length > 0) {
      missingRequired.push({ id: n.id, name: n.name, detail: empty.join("、") })
    }
  }

  // 6. 名寄せ未チェックのノード（status 未設定の既存データはチェック済み扱い）
  const unchecked = liveNodes
    .filter((n) => (n.status ?? "confirmed") === "provisional")
    .map((n) => ({
      id: n.id,
      name: n.name,
      detail: (n.labelIds ?? []).map(labelName).join("、") || "ラベルなし",
    }))

  return [
    {
      key: "schemaMismatch",
      category: "export",
      title: "スキーマに無い組み合わせ",
      description:
        "リレーションシップタイプのラベルペアに定義されていない組み合わせです。"
        + "ノードに上位ラベルを足すか、タイプ側にペアを足してください。",
      blocking: true,
      items: schemaMismatch,
    },
    {
      key: "missingRequired",
      category: "export",
      title: "必須プロパティが空のノード",
      description: "必須にしたプロパティに、値が入っていないノードです。",
      blocking: false,
      items: missingRequired,
    },
    {
      key: "orphanNodes",
      category: "export",
      title: "孤立ノード",
      description:
        "どのリレーションシップにも現れないノードです。Neo4j に入れても他と繋がりません"
        + "（カテゴリノードは除いています）。",
      blocking: false,
      items: orphanNodes,
    },
    {
      key: "unchecked",
      category: "export",
      title: "名寄せ未チェックのノード",
      description: "同じものが二重に登録されていないか、まだ確認していないノードです。",
      blocking: false,
      items: unchecked,
    },
    {
      key: "unusedLabels",
      category: "schema",
      title: "ノードが付いていないラベル",
      description: "どのノードにも付いていないラベルです。",
      blocking: false,
      items: unusedLabels,
    },
    {
      key: "unusedRelTypes",
      category: "schema",
      title: "リレーションシップが作られていないリレーションシップタイプ",
      description:
        "定義はあるものの、それを使ったリレーションシップがまだ1件も無いリレーションシップタイプです。",
      blocking: false,
      items: unusedRelTypes,
    },
  ]
}

// ─────────────────────────────────────────────
// Cypher 生成
// ─────────────────────────────────────────────
export function buildCypher(data: GraphData): string {
  const { labels, relTypes, nodes, relationships } = data
  const labelById = new Map(labels.map((l) => [l.id, l]))
  const typeById = new Map(relTypes.map((t) => [t.id, t]))
  const liveNodes = nodes.filter((n) => n.status !== "merged")

  // そのノードの Neo4j ラベル名（付与順。消えたラベルは落とす）
  const labelNamesOf = (n: GraphNode): string[] =>
    (n.labelIds ?? []).map((id) => labelById.get(id)?.name).filter((v): v is string => !!v)

  // MERGE / MATCH の引き当てに使うラベル。全ノード共通の目印ラベルは付けない
  //   （付けるとスキーマ図で全ラベルと繋がったハブとして描かれ、図が読めなくなる）。
  //   ラベルが1つも無いノードはラベル無しで引き当てる（全件走査になるが、
  //   そもそもエクスポート前チェックで「ラベルなし」として挙げている対象）。
  const anchorOf = (n: GraphNode): string => {
    const first = labelNamesOf(n)[0]
    return first ? `:${escLabel(first)}` : ""
  }
  const nodeById = new Map(liveNodes.map((n) => [n.id, n]))
  const matchPattern = (alias: string, nodeId: string) => {
    const n = nodeById.get(nodeId)
    return `(${alias}${n ? anchorOf(n) : ""} {nodeId: ${escStr(nodeId)}})`
  }

  const lines: string[] = []

  // 引き当てを速くするため、使われているラベルごとに nodeId のインデックスを張る
  const usedLabels = [...new Set(liveNodes.flatMap((n) => labelNamesOf(n).slice(0, 1)))]
  if (usedLabels.length > 0) {
    lines.push("// 引き当て用のインデックス。既にあれば何もしない。")
    for (const name of usedLabels) {
      lines.push(`CREATE INDEX IF NOT EXISTS FOR (n:${escLabel(name)}) ON (n.nodeId);`)
    }
    lines.push("")
  }

  lines.push("// ノード: nodeId 一致で MERGE するので、何度流し込んでも重複しない。")
  lines.push("// 付与されたラベルは Neo4j のラベルとして付ける。")
  for (const n of liveNodes) {
    const labelNames = labelNamesOf(n)
    const sets: string[] = [`n.name = ${escStr(n.name)}`]
    // 先頭ラベルは MERGE 側で付くので、2つ目以降をここで足す
    for (const name of labelNames.slice(1)) sets.push(`n:${escLabel(name)}`)
    for (const [key, value] of Object.entries(n.properties ?? {})) {
      if (value === null || value === undefined || value === "") continue
      sets.push(`n.${escLabel(key)} = ${escStr(String(value))}`)
    }
    // 来歴
    if (n.registeredBy) sets.push(`n.registeredBy = ${escStr(n.registeredBy)}`)
    if (n.registeredAt) sets.push(`n.registeredAt = ${escStr(n.registeredAt)}`)
    if (n.updatedBy) sets.push(`n.updatedBy = ${escStr(n.updatedBy)}`)
    if (n.updatedAt) sets.push(`n.updatedAt = ${escStr(n.updatedAt)}`)
    lines.push(`MERGE ${matchPattern("n", n.id)} SET ${sets.join(", ")};`)
  }

  const liveIds = new Set(liveNodes.map((n) => n.id))
  const emitted = relationships.filter((r) => liveIds.has(r.startNodeId) && liveIds.has(r.endNodeId))

  lines.push("")
  lines.push("// リレーションシップ: タイプ名をそのまま関係タイプにする。出典・根拠・承認者も残す。")
  for (const r of emitted) {
    const sets: string[] = []
    for (const [key, value] of Object.entries(r.properties ?? {})) {
      if (value === null || value === undefined || value === "") continue
      sets.push(`r.${escLabel(key)} = ${escStr(String(value))}`)
    }
    // 成立条件は、条件セット1つを人が読める1行（条件を「かつ」で結んだもの）にし、その配列で出す。
    // 配列の要素同士は「または」。Graph＋RAG で LLM がそのまま読むので、構造化より読みやすさを優先する
    // （入れ子の構造は Neo4j のプロパティに載らない。文字列の配列なら載る）。
    const slots = typeById.get(r.relTypeId)?.conditions
    const conditionTexts = conditionSetsOf(r)
      .map((set) => formatTripletConditions(slots, set).join(" かつ "))
      .filter((text) => text !== "")
    if (conditionTexts.length > 0) sets.push(`r.conditions = [${conditionTexts.map(escStr).join(", ")}]`)
    if (r.sourceDocName) sets.push(`r.sourceDoc = ${escStr(r.sourceDocName)}`)
    if (r.evidence) sets.push(`r.evidence = ${escStr(r.evidence)}`)
    if (r.approvedBy) sets.push(`r.approvedBy = ${escStr(r.approvedBy)}`)
    if (r.approvedAt) sets.push(`r.approvedAt = ${escStr(r.approvedAt)}`)

    lines.push(`MATCH ${matchPattern("s", r.startNodeId)}, ${matchPattern("e", r.endNodeId)}`)
    lines.push(
      `MERGE (s)-[r:${escLabel(r.relTypeName)} {relationshipId: ${escStr(r.id)}}]->(e)` +
        (sets.length ? ` SET ${sets.join(", ")}` : "") + ";",
    )
  }

  const skipped = relationships.length - emitted.length
  if (skipped > 0) {
    lines.push("")
    lines.push(`// 端のノードが統合済み／見つからないため出力しなかったリレーションシップ: ${skipped}件`)
  }
  return lines.join("\n")
}

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
