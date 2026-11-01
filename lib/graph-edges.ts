// グラフビューに出す「線」の共通の形。
//
// インスタンス同士のトリプレット（triplets）と、端にクラスを含むトリプレット
// （classTriplets）は保存場所も型も別だが、描くときはどちらも「ノード→ノード」
// の1本でしかない。描画側が2種類の型を意識しなくて済むよう、ここで1つに均す。

import type { ClassTriplet, OntologyInstance, Triplet } from "./types"

export type GraphEndKind = "class" | "instance"

export type GraphEnd = {
  kind: GraphEndKind
  id: string
  // 表示名（取得できなければ保存時のスナップショット）
  name: string
  // 型として見るときのクラス。kind === "class" なら自分自身。
  classId: string | null
}

export type GraphEdge = {
  id: string
  source: GraphEnd
  target: GraphEnd
  predicateRelationId: string
  predicateName: string
  attributes: Record<string, string>
}

// ノードのキー。クラスとインスタンスでid空間が別なので、種類を前置して混ざらないようにする。
export function endKey(end: GraphEnd): string {
  return `${end.kind}:${end.id}`
}

export function buildGraphEdges(
  triplets: Triplet[],
  classTriplets: ClassTriplet[],
  instById: Map<string, OntologyInstance>,
  classNameById: Map<string, string>,
): GraphEdge[] {
  const instEnd = (id: string, snapshotName: string, snapshotClassId: string | null): GraphEnd => {
    const inst = instById.get(id)
    return { kind: "instance", id, name: inst?.name ?? snapshotName, classId: inst?.classId ?? snapshotClassId }
  }
  const classEnd = (id: string, snapshotName: string): GraphEnd => ({
    kind: "class",
    id,
    name: classNameById.get(id) ?? snapshotName,
    classId: id,
  })
  const end = (kind: GraphEndKind, id: string, snapshotName: string): GraphEnd =>
    kind === "class" ? classEnd(id, snapshotName) : instEnd(id, snapshotName, null)

  return [
    ...triplets.map((t) => ({
      id: t.id,
      source: instEnd(t.subjectInstanceId, t.subjectName, t.subjectClassId),
      target: instEnd(t.objectInstanceId, t.objectName, t.objectClassId),
      predicateRelationId: t.predicateRelationId,
      predicateName: t.predicateName,
      attributes: t.attributes ?? {},
    })),
    ...classTriplets.map((ct) => ({
      id: ct.id,
      source: end(ct.subjectKind, ct.subjectId, ct.subjectName),
      target: end(ct.objectKind, ct.objectId, ct.objectName),
      predicateRelationId: ct.predicateRelationId,
      predicateName: ct.predicateName,
      attributes: {},
    })),
  ]
}
