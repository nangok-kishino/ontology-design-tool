import type { ConfirmationEvent, OntologyClass, OntologyInstance, OntologyRelation, Triplet } from "@/lib/types"

// 「未確認」／「確認済み」／「確認済み*（最終確認後に編集あり）」の3状態
export type ConfirmationState = "unconfirmed" | "confirmed" | "confirmed_edited"

export type ConfirmationStatus = {
  state: ConfirmationState
  // state !== "unconfirmed" のとき、最新の確認レコード
  latestConfirm?: {
    at: string
    actor: string
    confirmerName: string
  }
}

// 確認レコード配列から現在の派生状態を導出する。
// ルール:
//   - 最新の confirm/unconfirm が unconfirm、または一度も confirm がない → "unconfirmed"
//   - 最新の confirm/unconfirm が confirm で、それ以降に edit が無い → "confirmed"
//   - 最新の confirm/unconfirm が confirm で、それ以降に edit が有る → "confirmed_edited"
export function deriveConfirmationStatus(events: ConfirmationEvent[] | undefined): ConfirmationStatus {
  if (!events || events.length === 0) return { state: "unconfirmed" }
  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at))

  let latestConfirmIdx = -1
  for (let i = sorted.length - 1; i >= 0; i--) {
    const e = sorted[i]
    if (e.type === "unconfirm") return { state: "unconfirmed" }
    if (e.type === "confirm") {
      latestConfirmIdx = i
      break
    }
  }
  if (latestConfirmIdx < 0) return { state: "unconfirmed" }

  const conf = sorted[latestConfirmIdx]
  const editedAfter = sorted.slice(latestConfirmIdx + 1).some((e) => e.type === "edit")
  return {
    state: editedAfter ? "confirmed_edited" : "confirmed",
    latestConfirm: {
      at: conf.at,
      actor: conf.actor,
      confirmerName: conf.confirmerName ?? "",
    },
  }
}

// クラス編集で確認履歴の [edit] を積むべきフィールドを比較。
// 対象: ラベル(name)・英名(nameEn)・説明(description)・上位クラス(parentId)
export function diffClassFields(before: OntologyClass, after: OntologyClass): string[] {
  const changed: string[] = []
  if ((before.name ?? "") !== (after.name ?? "")) changed.push("name")
  if ((before.nameEn ?? "") !== (after.nameEn ?? "")) changed.push("nameEn")
  if ((before.description ?? "") !== (after.description ?? "")) changed.push("description")
  if ((before.parentId ?? null) !== (after.parentId ?? null)) changed.push("parentId")
  return changed
}

// リレーション編集で確認履歴の [edit] を積むべきフィールドを比較。
// 対象: ラベル(name)・英名(nameEn)・説明(description)・始点/終点(classPairs)・上位リレーション(parentRelationId)・成立条件(conditions)
export function diffRelationFields(before: OntologyRelation, after: OntologyRelation): string[] {
  const changed: string[] = []
  if ((before.name ?? "") !== (after.name ?? "")) changed.push("name")
  if ((before.nameEn ?? "") !== (after.nameEn ?? "")) changed.push("nameEn")
  if ((before.description ?? "") !== (after.description ?? "")) changed.push("description")
  const beforePairs = JSON.stringify([...(before.classPairs ?? [])].sort(byPair))
  const afterPairs = JSON.stringify([...(after.classPairs ?? [])].sort(byPair))
  if (beforePairs !== afterPairs) changed.push("classPairs")
  if ((before.parentRelationId ?? null) !== (after.parentRelationId ?? null)) changed.push("parentRelationId")
  if (JSON.stringify(before.conditions ?? []) !== JSON.stringify(after.conditions ?? [])) changed.push("conditions")
  return changed
}

function byPair(a: { sourceClassId: string; targetClassId: string }, b: { sourceClassId: string; targetClassId: string }) {
  return (a.sourceClassId + "|" + a.targetClassId).localeCompare(b.sourceClassId + "|" + b.targetClassId)
}

// インスタンス編集で確認履歴の [edit] を積むべきフィールドを比較。
// 対象: 名前(name)・所属クラス(classId)・属性値(attributes)
export function diffInstanceFields(before: OntologyInstance, after: OntologyInstance): string[] {
  const changed: string[] = []
  if ((before.name ?? "") !== (after.name ?? "")) changed.push("name")
  if ((before.classId ?? null) !== (after.classId ?? null)) changed.push("classId")
  if (JSON.stringify(before.attributes ?? {}) !== JSON.stringify(after.attributes ?? {})) changed.push("attributes")
  return changed
}

// トリプレット編集で確認履歴の [edit] を積むべきフィールドを比較。
// 対象: 主語/述語/目的語（スナップショット名も含む）・属性値
export function diffTripletFields(before: Triplet, after: Triplet): string[] {
  const changed: string[] = []
  if (before.subjectInstanceId !== after.subjectInstanceId) changed.push("subjectInstanceId")
  if (before.predicateRelationId !== after.predicateRelationId) changed.push("predicateRelationId")
  if (before.objectInstanceId !== after.objectInstanceId) changed.push("objectInstanceId")
  if ((before.subjectName ?? "") !== (after.subjectName ?? "")) changed.push("subjectName")
  if ((before.predicateName ?? "") !== (after.predicateName ?? "")) changed.push("predicateName")
  if ((before.objectName ?? "") !== (after.objectName ?? "")) changed.push("objectName")
  if (JSON.stringify(before.attributes ?? {}) !== JSON.stringify(after.attributes ?? {})) changed.push("attributes")
  return changed
}

// 確認履歴に [confirm] イベントを追加した新しい配列を返す（イミュータブル）
export function appendConfirmEvent(
  events: ConfirmationEvent[] | undefined,
  actor: string,
  confirmerName: string,
  at: string = new Date().toISOString(),
): ConfirmationEvent[] {
  return [...(events ?? []), { type: "confirm", at, actor, confirmerName }]
}

// 確認履歴に [unconfirm] イベントを追加した新しい配列を返す
export function appendUnconfirmEvent(
  events: ConfirmationEvent[] | undefined,
  actor: string,
  at: string = new Date().toISOString(),
): ConfirmationEvent[] {
  return [...(events ?? []), { type: "unconfirm", at, actor }]
}

// 確認履歴に [edit] イベントを追加した新しい配列を返す。
// editedFields が空の場合は何も追加せず元の配列を返す。
export function appendEditEvent(
  events: ConfirmationEvent[] | undefined,
  actor: string,
  editedFields: string[],
  at: string = new Date().toISOString(),
): ConfirmationEvent[] | undefined {
  if (!editedFields || editedFields.length === 0) return events
  return [...(events ?? []), { type: "edit", at, actor, editedFields }]
}

// 確認日時の表示フォーマット（基本情報エリア／一覧のツールチップで共用）
export function formatConfirmDateTime(iso: string | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
}
