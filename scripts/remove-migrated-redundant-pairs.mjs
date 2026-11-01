// 移行（migrate-to-graph-model.mjs）で間違って付けてしまったラベルペアを消す。
//
//   node scripts/remove-migrated-redundant-pairs.mjs .env.local           # 下見（書き込みなし）
//   node scripts/remove-migrated-redundant-pairs.mjs .env.local --write   # 実行
//
// 【間違いの中身】旧データには、子クラスにも親クラスと同じ始点・終点のペアが重ねて保存されていた。
// 旧画面は親のペアで説明できるものを表示しなかったので、存在しないのと同じだった。
// 移行スクリプトはそれを確かめずに全部写したため、ラベルペアに余計なものが入った。
//
// 消す対象：同じリレーションシップタイプの中に、旧クラスの親子で見てそれを含む別のペアがあるもの。
// 消したあとに既存のリレーションシップがペアに合わなくなるものが出ないかも確かめる。

import { readFileSync } from "node:fs"
import { createRequire } from "node:module"

const require = createRequire(new URL("../package.json", import.meta.url))
const { CosmosClient } = require("@azure/cosmos")

const envPath = process.argv[2]
const WRITE = process.argv.includes("--write")
if (!envPath) {
  console.error("使い方: node scripts/remove-migrated-redundant-pairs.mjs <.envファイル> [--write]")
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

const [projects, classes, labels, relTypes, nodes, relationships] = await Promise.all(
  ["projects", "classes", "labels", "relationshipTypes", "nodes", "relationships"].map(read))

const projectName = new Map(projects.map((p) => [p.id, p.name]))
const labelName = new Map(labels.map((l) => [l.id, l.name]))
const classById = new Map(classes.map((c) => [c.id, c]))

// 旧クラスの親子で、descendantId が ancestorId 自身かその子孫か
const isSelfOrDescendant = (descendantId, ancestorId) => {
  let cur = descendantId
  const seen = new Set()
  while (cur && !seen.has(cur)) {
    if (cur === ancestorId) return true
    seen.add(cur)
    cur = classById.get(cur)?.parentId ?? null
  }
  return false
}
const samePair = (a, b) => a.sourceLabelId === b.sourceLabelId && a.targetLabelId === b.targetLabelId
const covers = (q, p) => isSelfOrDescendant(p.sourceLabelId, q.sourceLabelId) && isSelfOrDescendant(p.targetLabelId, q.targetLabelId)

// リレーションシップがタイプのペアに合うか（ラベルの集合に含まれるか）
const nodeById = new Map(nodes.map((n) => [n.id, n]))
const fits = (rel, pairs) => {
  const s = nodeById.get(rel.startNodeId)?.labelIds ?? []
  const e = nodeById.get(rel.endNodeId)?.labelIds ?? []
  return pairs.some((p) => s.includes(p.sourceLabelId) && e.includes(p.targetLabelId))
}

let total = 0
const updates = []
for (const t of relTypes) {
  const pairs = t.labelPairs ?? []
  const keep = pairs.filter((p) => !pairs.some((q) => !samePair(q, p) && covers(q, p)))
  const removed = pairs.length - keep.length
  if (removed === 0) continue
  total += removed

  const rels = relationships.filter((r) => r.relTypeId === t.id)
  const brokenBefore = rels.filter((r) => !fits(r, pairs)).length
  const brokenAfter = rels.filter((r) => !fits(r, keep)).length
  console.log(`[${projectName.get(t.projectId)}] ${t.name}: ${pairs.length} → ${keep.length}（${removed}本消す）` +
    `　リレーションシップ ${rels.length}件中 合わないもの ${brokenBefore} → ${brokenAfter}`)
  console.log(`    残す: ${keep.map((p) => `${labelName.get(p.sourceLabelId)}→${labelName.get(p.targetLabelId)}`).join(", ")}`)
  updates.push({ t, keep })
}
console.log(`\n合計 ${total}本`)

if (WRITE) {
  const container = db.container("relationshipTypes")
  for (const { t, keep } of updates) {
    const { _rid, _self, _etag, _attachments, _ts, ...rest } = t
    await container.items.upsert({ ...rest, labelPairs: keep })
  }
  console.log(`${updates.length}タイプを書き換えました`)
} else {
  console.log("下見のみ（--write で実行）")
}
