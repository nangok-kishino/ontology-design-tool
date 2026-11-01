// 新モデル（ラベル／リレーションシップタイプ／ノード／リレーションシップ）の
// 確認履歴まわり。派生状態の判定そのものは lib/confirmation.ts を使い回す。

import type { Label, LabelPair, RelationshipType } from "./graph-types"

// ラベル編集で確認履歴の [edit] を積むべきフィールドを比較。
// 対象: 名前(name)・英名(nameEn)・同義語(synonyms)・説明(description)
// groupId / order は整理の都合なので含めない（確認済みを無効化しない）。
export function diffLabelFields(before: Label, after: Label): string[] {
  const changed: string[] = []
  if ((before.name ?? "") !== (after.name ?? "")) changed.push("name")
  if ((before.nameEn ?? "") !== (after.nameEn ?? "")) changed.push("nameEn")
  if ((before.synonyms ?? []).join("\n") !== (after.synonyms ?? []).join("\n")) changed.push("synonyms")
  if ((before.description ?? "") !== (after.description ?? "")) changed.push("description")
  return changed
}

export const LABEL_FIELD_LABEL: Record<string, string> = {
  name: "ラベル名",
  nameEn: "英語名",
  synonyms: "同義語",
  description: "説明",
  properties: "プロパティ",
}

function byPair(a: LabelPair, b: LabelPair) {
  return (a.sourceLabelId + "|" + a.targetLabelId).localeCompare(b.sourceLabelId + "|" + b.targetLabelId)
}

// リレーションシップタイプ編集で [edit] を積むべきフィールドを比較。
export function diffRelTypeFields(before: RelationshipType, after: RelationshipType): string[] {
  const changed: string[] = []
  if ((before.name ?? "") !== (after.name ?? "")) changed.push("name")
  if ((before.nameEn ?? "") !== (after.nameEn ?? "")) changed.push("nameEn")
  if ((before.description ?? "") !== (after.description ?? "")) changed.push("description")
  const beforePairs = JSON.stringify([...(before.labelPairs ?? [])].sort(byPair))
  const afterPairs = JSON.stringify([...(after.labelPairs ?? [])].sort(byPair))
  if (beforePairs !== afterPairs) changed.push("labelPairs")
  if (JSON.stringify(before.conditions ?? []) !== JSON.stringify(after.conditions ?? [])) changed.push("conditions")
  return changed
}
