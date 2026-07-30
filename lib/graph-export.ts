// 本登録トリプレット → Neo4j 向け Cypher の生成（エクスポートのみ）。
//   インスタンス = ノード（:Instance かつ :`クラス名`）、トリプレット = リレーション（:`述語名`）。
//   すべて MERGE で生成するため、何度流し込んでも重複しない（id一致で冪等）。
// 動的ラベル/型・属性キーは DB 由来の統制語彙。バッククォートをエスケープして安全に埋め込む。
//
// ノードには、そのインスタンスの属性値（attributes）と登録者/日時も出力する。
// エッジには、出典・根拠文・承認者/日時を出力する（トレーサビリティ）。

import type { Triplet, OntologyInstance } from "./types"

function escLabel(s: string): string {
  return "`" + s.replace(/`/g, "``") + "`"
}
function escStr(s: string): string {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'
}

export function buildCypher(
  triplets: Triplet[],
  classNameById: Map<string, string>,
  instById?: Map<string, OntologyInstance>,
): string {
  // ノードをインスタンスid単位で一意化（スナップショットをフォールバックにしつつ、
  // 実体があれば最新のインスタンスから名前・クラス・属性を採る）
  const nodeIds = new Map<string, { name: string; classId: string | null }>()
  for (const t of triplets) {
    nodeIds.set(t.subjectInstanceId, { name: t.subjectName, classId: t.subjectClassId })
    nodeIds.set(t.objectInstanceId, { name: t.objectName, classId: t.objectClassId })
  }

  const lines: string[] = []
  lines.push("// ノード（インスタンス）: id一致でMERGE（再実行しても重複しない）。属性値も出力。")
  for (const [id, snap] of nodeIds) {
    const inst = instById?.get(id)
    const name = inst?.name ?? snap.name
    const classId = inst?.classId ?? snap.classId
    const cls = classId ? classNameById.get(classId) : undefined

    const sets: string[] = [`n.name = ${escStr(name)}`]
    if (classId) sets.push(`n.classId = ${escStr(classId)}`)
    if (cls) {
      sets.push(`n.className = ${escStr(cls)}`)
      sets.push(`n:${escLabel(cls)}`)
    }
    // インスタンス属性（ユーザー定義の属性値）
    const attrs = inst?.attributes ?? {}
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === "") continue
      sets.push(`n.${escLabel(k)} = ${escStr(String(v))}`)
    }
    // 来歴（登録者・日時）
    if (inst?.registeredBy) sets.push(`n.registeredBy = ${escStr(inst.registeredBy)}`)
    if (inst?.registeredAt) sets.push(`n.registeredAt = ${escStr(inst.registeredAt)}`)
    if (inst?.updatedBy) sets.push(`n.updatedBy = ${escStr(inst.updatedBy)}`)
    if (inst?.updatedAt) sets.push(`n.updatedAt = ${escStr(inst.updatedAt)}`)

    lines.push(`MERGE (n:Instance {id: ${escStr(id)}}) SET ${sets.join(", ")};`)
  }

  lines.push("")
  lines.push("// トリプレット: リレーションとしてMERGE。出典・根拠文・承認者/日時も出力。")
  for (const t of triplets) {
    const rsets: string[] = []
    // このトリプレット（エッジ）固有の属性値
    for (const [k, v] of Object.entries(t.attributes ?? {})) {
      if (v === null || v === undefined || v === "") continue
      rsets.push(`r.${escLabel(k)} = ${escStr(String(v))}`)
    }
    if (t.sourceDocName) rsets.push(`r.sourceDoc = ${escStr(t.sourceDocName)}`)
    if (t.evidence) rsets.push(`r.evidence = ${escStr(t.evidence)}`)
    if (t.approvedBy) rsets.push(`r.approvedBy = ${escStr(t.approvedBy)}`)
    if (t.approvedAt) rsets.push(`r.approvedAt = ${escStr(t.approvedAt)}`)
    lines.push(
      `MATCH (s:Instance {id: ${escStr(t.subjectInstanceId)}}), (o:Instance {id: ${escStr(t.objectInstanceId)}})`,
    )
    lines.push(
      `MERGE (s)-[r:${escLabel(t.predicateName)} {id: ${escStr(t.id)}}]->(o)` +
        (rsets.length ? ` SET ${rsets.join(", ")}` : "") + ";",
    )
  }
  return lines.join("\n")
}
