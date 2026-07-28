// トリプレットの「解決」＝表層→本登録インスタンス紐付け・クラスペア整合・判定。
// すべて LLM 不要のサーバ側照合処理。インスタンスが本登録されるたびに再解決すれば
// 未解決→正当/型矛盾 へ自動で埋まる（設計書 §2-2）。
//
// フェーズ1では手動追加のクラスペア整合チェック（classifyTriplet / relationAllowsPair）を使う。
// 文書candidateの表層解決（resolveByText）はフェーズ2の文書取込みビューで使用する。

import type { OntologyInstance, OntologyRelation, TripletCandidate, TripletResolveStatus } from "./types"
import { isConfirmed } from "./instance-status"

// リレーションが (sourceClassId, targetClassId) のクラスペアを許可しているか。
// フェーズ1は完全一致。将来 parentId 継承（サブクラス許容）を足す余地あり。
export function relationAllowsPair(
  relation: Pick<OntologyRelation, "classPairs">,
  sourceClassId: string | null | undefined,
  targetClassId: string | null | undefined,
): boolean {
  if (!sourceClassId || !targetClassId) return false
  return (relation.classPairs ?? []).some(
    (p) => p.sourceClassId === sourceClassId && p.targetClassId === targetClassId,
  )
}

// 本登録インスタンス2つ＋リレーションから、トリプレットの整合性を判定する。
//   valid          : クラスペアが許可されている
//   type_conflict  : 両端は解決できたがクラスペアが未定義
//   unresolved     : 主語/目的語/述語のいずれかが解決できない
export function classifyTriplet(params: {
  subject?: Pick<OntologyInstance, "classId"> | null
  object?: Pick<OntologyInstance, "classId"> | null
  relation?: Pick<OntologyRelation, "classPairs"> | null
}): TripletResolveStatus {
  const { subject, object, relation } = params
  if (!subject || !object || !relation) return "unresolved"
  return relationAllowsPair(relation, subject.classId, object.classId) ? "valid" : "type_conflict"
}

// candidate（選ばれた id）を、現在の本登録インスタンス・定義済みリレーションに対して
// 解決・判定した結果。文書取込みビューの表示と、承認（本登録）時の紐付けに使う。
export type ResolvedTripletCandidate = Omit<
  TripletCandidate,
  "subjectInstanceId" | "predicateRelationId" | "objectInstanceId"
> & {
  // 解決できた id（参照先が削除／本登録でなくなった場合は null）
  subjectInstanceId: string | null
  subjectName: string | null
  subjectClassId: string | null
  predicateRelationId: string | null
  predicateName: string | null
  objectInstanceId: string | null
  objectName: string | null
  objectClassId: string | null
  status: TripletResolveStatus
}

// candidate を現在の状態に対して解決・判定する（LLM不要）。
//   valid          : 両端が本登録インスタンスに解決でき、クラスペアも許可されている
//   type_conflict  : 両端は解決できたがクラスペアが未定義
//   unresolved     : 参照先が削除された／本登録でなくなった（通常は起きない）
export function resolveCandidate(
  cand: TripletCandidate,
  instances: OntologyInstance[],
  relations: OntologyRelation[],
): ResolvedTripletCandidate {
  const subject = instances.find((i) => i.id === cand.subjectInstanceId && isConfirmed(i)) ?? null
  const object = instances.find((i) => i.id === cand.objectInstanceId && isConfirmed(i)) ?? null
  const relation = relations.find((r) => r.id === cand.predicateRelationId) ?? null
  const status = classifyTriplet({ subject, object, relation })
  return {
    ...cand,
    resolvedStatus: status,
    subjectInstanceId: subject?.id ?? null,
    subjectName: subject?.name ?? cand.subjectText ?? null,
    subjectClassId: subject?.classId ?? null,
    predicateRelationId: relation?.id ?? null,
    predicateName: relation?.name ?? cand.predicateText ?? null,
    objectInstanceId: object?.id ?? null,
    objectName: object?.name ?? cand.objectText ?? null,
    objectClassId: object?.classId ?? null,
    status,
  }
}
