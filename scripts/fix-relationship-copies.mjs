// リレーションシップの写し（始点・終点ノードの名前とラベル、タイプ名）を今のデータに合わせ、
// 行き先のないプロパティ定義を消す。
//
//   node scripts/fix-relationship-copies.mjs .env.local           # 下見（書き込みなし）
//   node scripts/fix-relationship-copies.mjs .env.local --write   # 実行
//
// 【なぜ要るか】ノードやタイプを直しても写しを更新しない不具合があった（API側は直した）。
// その間にずれた分をここで合わせる。行き先のない定義は、旧データで消されたクラスの属性を
// 移行で写してしまったもの。

import { readFileSync } from "node:fs"
import { createRequire } from "node:module"

const require = createRequire(new URL("../package.json", import.meta.url))
const { CosmosClient } = require("@azure/cosmos")

const envPath = process.argv[2]
const WRITE = process.argv.includes("--write")
if (!envPath) {
  console.error("使い方: node scripts/fix-relationship-copies.mjs <.envファイル> [--write]")
  process.exit(1)
}

const env = {}
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
}

const client = new CosmosClient({ endpoint: env.COSMOS_ENDPOINT, key: env.COSMOS_KEY })
const db = client.database(env.COSMOS_DATABASE_ID || "ontology-db")
const read = async (id) => (await db.container(id).items.readAll().fetchAll()).resources
const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("_")))

const [projects, labels, relTypes, nodes, relationships, propertyDefs] = await Promise.all(
  ["projects", "labels", "relationshipTypes", "nodes", "relationships", "propertyDefs"].map(read))

const projectName = new Map(projects.map((p) => [p.id, p.name]))
const labelIds = new Set(labels.map((l) => l.id))
const typeById = new Map(relTypes.map((t) => [t.id, t]))
const nodeById = new Map(nodes.map((n) => [n.id, n]))
const sameIds = (a, b) => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort())

// ─── 写しのずれ ───
const relFixes = []
for (const r of relationships) {
  const s = nodeById.get(r.startNodeId)
  const e = nodeById.get(r.endNodeId)
  const t = typeById.get(r.relTypeId)
  if (!s || !e || !t) continue
  const next = {
    ...strip(r),
    startNodeName: s.name, startNodeLabelIds: s.labelIds ?? [],
    endNodeName: e.name, endNodeLabelIds: e.labelIds ?? [],
    relTypeName: t.name,
  }
  if (
    next.startNodeName === r.startNodeName && next.endNodeName === r.endNodeName && next.relTypeName === r.relTypeName &&
    sameIds(next.startNodeLabelIds, r.startNodeLabelIds) && sameIds(next.endNodeLabelIds, r.endNodeLabelIds)
  ) continue
  relFixes.push(next)
  console.log(`[${projectName.get(r.projectId)}] 写しを合わせる: ${r.startNodeName} -${r.relTypeName}-> ${r.endNodeName}`)
}

// ─── 行き先のないプロパティ定義 ───
const orphanDefs = propertyDefs.filter((d) =>
  (d.targetType === "label" && !labelIds.has(d.targetId)) ||
  (d.targetType === "relationshipType" && !typeById.has(d.targetId)) ||
  (d.targetType === "project" && !projectName.has(d.targetId)))
for (const d of orphanDefs) console.log(`[${projectName.get(d.projectId)}] 定義を消す: ${d.name}（${d.targetType}）`)

console.log(`\n写し ${relFixes.length}件・定義 ${orphanDefs.length}件`)

if (WRITE) {
  const relContainer = db.container("relationships")
  for (const r of relFixes) await relContainer.items.upsert(r)
  const propContainer = db.container("propertyDefs")
  for (const d of orphanDefs) await propContainer.item(d.id, d.id).delete()
  console.log("書き込みました")
} else {
  console.log("下見のみ（--write で実行）")
}
