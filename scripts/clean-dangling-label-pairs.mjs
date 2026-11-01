// 参照先のラベルが存在しないラベルペアを取り除く。
//
//   node scripts/clean-dangling-label-pairs.mjs .env.local           # 下見
//   node scripts/clean-dangling-label-pairs.mjs .env.local --write   # 実行
//
// 旧モデルでは、消えたクラスを指すクラスペアが保存されたまま残り、表示のたびに
// normalizeClassPairs で取り除かれていた（保存はされ続けていた）。
// 新モデルではそれを溜めない方針なので、移行後に1度だけ掃除する。

import { readFileSync } from "node:fs"
import { createRequire } from "node:module"

const require = createRequire(new URL("../package.json", import.meta.url))
const { CosmosClient } = require("@azure/cosmos")

const envPath = process.argv[2]
const WRITE = process.argv.includes("--write")
if (!envPath) {
  console.error("使い方: node scripts/clean-dangling-label-pairs.mjs <.envファイル> [--write]")
  process.exit(1)
}

const env = {}
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
}

const db = new CosmosClient({ endpoint: env.COSMOS_ENDPOINT, key: env.COSMOS_KEY })
  .database(env.COSMOS_DATABASE_ID || "ontology-db")
const read = async (id) => (await db.container(id).items.readAll().fetchAll()).resources

const labels = await read("labels")
const relTypes = await read("relationshipTypes")
const liveLabels = new Set(labels.map((l) => l.id))

let totalPairs = 0
let dropped = 0
const changed = []
for (const rt of relTypes) {
  const pairs = rt.labelPairs ?? []
  totalPairs += pairs.length
  const kept = pairs.filter((p) => liveLabels.has(p.sourceLabelId) && liveLabels.has(p.targetLabelId))
  if (kept.length !== pairs.length) {
    dropped += pairs.length - kept.length
    changed.push({ rt, kept, removed: pairs.length - kept.length })
  }
}

console.log(WRITE ? "=== 掃除を実行します ===" : "=== 下見（書き込みなし） ===")
console.log(`ラベルペア 合計 ${totalPairs} / 参照切れ ${dropped}`)
for (const c of changed) {
  console.log(`  ${c.rt.name}: ${c.removed}件を除去 → 残り ${c.kept.length}件`)
}
// 掃除の結果、ペアが1件も無くなるタイプ（画面で警告が出る）
const emptied = changed.filter((c) => c.kept.length === 0)
if (emptied.length) {
  console.log(`\n  ペアが0件になるタイプ: ${emptied.map((c) => c.rt.name).join(", ")}`)
}

if (!WRITE) {
  console.log("\n書き込むには --write を付けてください。")
  process.exit(0)
}

const container = db.container("relationshipTypes")
for (const c of changed) {
  await container.item(c.rt.id, c.rt.id).replace({ ...c.rt, labelPairs: c.kept })
}
console.log(`\n${changed.length}件のリレーションシップタイプを更新しました。`)
