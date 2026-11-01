// 旧モデル（クラス／リレーション／インスタンス／トリプレット／属性）から
// 新モデル（ラベル／リレーションシップタイプ／ノード／リレーションシップ／プロパティ）への移行。
//
//   node scripts/migrate-to-graph-model.mjs .env.local           # 下見（書き込みなし）
//   node scripts/migrate-to-graph-model.mjs .env.local --write   # 実行
//
// 【安全策】書き込むのは新しいコンテナだけ。旧コンテナには一切触らない。
// id は全て引き継ぎ、upsert で書くので、何度流しても同じ結果になる。

import { readFileSync } from "node:fs"
import { createRequire } from "node:module"

const require = createRequire(new URL("../package.json", import.meta.url))
const { CosmosClient } = require("@azure/cosmos")

const envPath = process.argv[2]
const WRITE = process.argv.includes("--write")
if (!envPath) {
  console.error("使い方: node scripts/migrate-to-graph-model.mjs <.envファイル> [--write]")
  process.exit(1)
}

const env = {}
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
}

const client = new CosmosClient({ endpoint: env.COSMOS_ENDPOINT, key: env.COSMOS_KEY })
const db = client.database(env.COSMOS_DATABASE_ID || "ontology-db")

const read = async (id) => {
  try {
    return (await db.container(id).items.readAll().fetchAll()).resources
  } catch {
    return []
  }
}
// Cosmos が付ける内部フィールドを落とす
const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("_")))

// ─── 読み込み ───
const [projects, classes, relations, instances, triplets, classTriplets, attributes, nameResolutions] =
  await Promise.all([
    read("projects"), read("classes"), read("relations"), read("instances"),
    read("triplets"), read("classTriplets"), read("attributes"), read("nameResolutions"),
  ])

const liveProjects = new Set(projects.map((p) => p.id))
const inLiveProject = (row) => liveProjects.has(row.projectId)

// ─── クラスの祖先チェーン ───
const classById = new Map(classes.map((c) => [c.id, c]))
const ancestryOf = (classId) => {
  const chain = []
  const seen = new Set()
  let cur = classId
  while (cur && classById.has(cur) && !seen.has(cur)) {
    seen.add(cur)
    chain.push(cur)
    cur = classById.get(cur).parentId ?? null
  }
  return chain
}

// ─── 予約ラベル「カテゴリ」（プロジェクトごとに1つ） ───
const CATEGORY_LABEL_NAME = "カテゴリ"
const categoryLabelId = (projectId) => `syslabel-category-${projectId}`
const now = new Date().toISOString()

const labels = []
for (const p of projects) {
  labels.push({
    id: categoryLabelId(p.id),
    projectId: p.id,
    name: CATEGORY_LABEL_NAME,
    description: "カテゴリそのものを表すノードに付ける予約ラベル。個体と区別するために使う。",
    system: "category",
    createdAt: now,
    updatedAt: now,
  })
}

// ─── クラス → ラベル（parentId を落とすだけ） ───
for (const c of classes.filter(inLiveProject)) {
  const { parentId, ...rest } = strip(c)
  labels.push(rest)
}

// ─── 属性 → プロパティ定義（scope を落とし、targetType を読み替え） ───
const TARGET_TYPE = { class: "label", relation: "relationshipType", project: "project" }
const propertyDefs = []
for (const a of attributes.filter(inLiveProject)) {
  const { scope, targetType, ...rest } = strip(a)
  propertyDefs.push({ ...rest, targetType: TARGET_TYPE[targetType] ?? targetType })
}

// 属性値のキー（属性id）→ プロパティ名。定義が見つからないものは捨てる。
const attrNameById = new Map(attributes.map((a) => [a.id, a.name]))
let droppedValues = 0
const toProperties = (attrs) => {
  const out = {}
  for (const [k, v] of Object.entries(attrs ?? {})) {
    const name = attrNameById.get(k)
    if (!name) { droppedValues++; continue }
    out[name] = v
  }
  return Object.keys(out).length ? out : undefined
}

// ─── リレーション → リレーションシップタイプ ───
const relTypes = []
for (const r of relations.filter(inLiveProject)) {
  const { classPairs, parentRelationId, ...rest } = strip(r)
  relTypes.push({
    ...rest,
    labelPairs: (classPairs ?? []).map((p) => ({
      sourceLabelId: p.sourceClassId,
      targetLabelId: p.targetClassId,
    })),
    parentRelTypeId: parentRelationId ?? null,
  })
}

// ─── インスタンス → ノード ───
const nodes = []
for (const i of instances.filter(inLiveProject)) {
  const { classId, attributes: attrs, ...rest } = strip(i)
  nodes.push({
    ...rest,
    labelIds: classId ? ancestryOf(classId) : [],
    properties: toProperties(attrs),
  })
}
const nodeById = new Map(nodes.map((n) => [n.id, n]))

// ─── クラストリプレットのためのカテゴリノード ───
// 端がクラスのトリプレットは、そのクラスのカテゴリノードを作って普通のリレーションシップにする。
const categoryNodeId = (classId) => `category-${classId}`
const neededCategories = new Set()
for (const ct of classTriplets.filter(inLiveProject)) {
  if (ct.subjectKind === "class") neededCategories.add(ct.subjectId)
  if (ct.objectKind === "class") neededCategories.add(ct.objectId)
}
for (const classId of neededCategories) {
  const cls = classById.get(classId)
  if (!cls) continue
  const node = {
    id: categoryNodeId(classId),
    projectId: cls.projectId,
    name: cls.name,
    labelIds: [...ancestryOf(classId), categoryLabelId(cls.projectId)],
    status: "confirmed",
    registeredBy: "migration",
    registeredAt: now,
    updatedBy: "migration",
    updatedAt: now,
  }
  nodes.push(node)
  nodeById.set(node.id, node)
}

// ─── トリプレット／クラストリプレット → リレーションシップ ───
const labelIdsOf = (nodeId, fallbackClassId) =>
  nodeById.get(nodeId)?.labelIds ?? (fallbackClassId ? ancestryOf(fallbackClassId) : [])

const relationships = []
for (const t of triplets.filter(inLiveProject)) {
  const {
    subjectInstanceId, predicateRelationId, objectInstanceId,
    subjectName, subjectClassId, predicateName, objectName, objectClassId,
    attributes: attrs, neo4jSynced, neo4jSyncedAt, ...rest
  } = strip(t)
  relationships.push({
    ...rest,
    startNodeId: subjectInstanceId,
    relTypeId: predicateRelationId,
    endNodeId: objectInstanceId,
    startNodeName: subjectName,
    startNodeLabelIds: labelIdsOf(subjectInstanceId, subjectClassId),
    relTypeName: predicateName,
    endNodeName: objectName,
    endNodeLabelIds: labelIdsOf(objectInstanceId, objectClassId),
    properties: toProperties(attrs),
  })
}

let skippedClassTriplets = 0
for (const ct of classTriplets.filter(inLiveProject)) {
  const { subjectKind, subjectId, objectKind, objectId, predicateRelationId,
          subjectName, predicateName, objectName, ...rest } = strip(ct)
  const startId = subjectKind === "class" ? categoryNodeId(subjectId) : subjectId
  const endId = objectKind === "class" ? categoryNodeId(objectId) : objectId
  if (!nodeById.has(startId) || !nodeById.has(endId)) { skippedClassTriplets++; continue }
  relationships.push({
    ...rest,
    startNodeId: startId,
    relTypeId: predicateRelationId,
    endNodeId: endId,
    startNodeName: subjectName,
    startNodeLabelIds: nodeById.get(startId).labelIds,
    relTypeName: predicateName,
    endNodeName: objectName,
    endNodeLabelIds: nodeById.get(endId).labelIds,
    approvedBy: rest.createdBy ?? "migration",
    approvedAt: rest.createdAt ?? now,
  })
}

// ─── 名寄せ辞書 ───
const nodeNameResolutions = []
for (const nr of nameResolutions.filter(inLiveProject)) {
  const { canonicalInstanceId, classId, ...rest } = strip(nr)
  nodeNameResolutions.push({ ...rest, canonicalNodeId: canonicalInstanceId, labelId: classId ?? null })
}

// ─── 結果 ───
const plan = [
  ["labels", labels],
  ["relationshipTypes", relTypes],
  ["nodes", nodes],
  ["relationships", relationships],
  ["propertyDefs", propertyDefs],
  ["nodeNameResolutions", nodeNameResolutions],
]

console.log(WRITE ? "=== 移行を実行します ===" : "=== 下見（書き込みなし） ===")
for (const [name, rows] of plan) console.log(`  ${name}: ${rows.length}件`)
console.log(`\n  カテゴリノードを新規作成: ${neededCategories.size}件`)
console.log(`  定義が見つからず捨てたプロパティ値: ${droppedValues}個`)
if (skippedClassTriplets) console.log(`  端のノードが見つからず飛ばしたクラストリプレット: ${skippedClassTriplets}件`)
const orphan = (rows) => rows.filter((r) => !liveProjects.has(r.projectId)).length
console.log(`  消えたプロジェクトに属していて除外した行: ` +
  `クラス${orphan(classes)} リレーション${orphan(relations)} インスタンス${orphan(instances)} トリプレット${orphan(triplets)}`)

const labelCounts = {}
for (const n of nodes) labelCounts[n.labelIds.length] = (labelCounts[n.labelIds.length] ?? 0) + 1
console.log(`  ノードのラベル数:`, labelCounts)

if (!WRITE) {
  console.log("\n書き込むには --write を付けてください。")
  process.exit(0)
}

for (const [name, rows] of plan) {
  const { container } = await db.containers.createIfNotExists({ id: name, partitionKey: { paths: ["/id"] } })
  let done = 0
  // Cosmos の無料枠で RU を使い切らないよう、少しずつ流す
  for (let i = 0; i < rows.length; i += 20) {
    await Promise.all(rows.slice(i, i + 20).map((row) => container.items.upsert(row)))
    done += Math.min(20, rows.length - i)
  }
  console.log(`  ${name}: ${done}件 書き込み完了`)
}
console.log("\n完了しました。旧コンテナは変更していません。")
