// リレーション成立条件の表示用フォーマッタ。
//   一覧のツールチップ／グラフのホバー表示など、UIから共通で使う。

import type { RelationCondition, RelationConditionOperator } from "@/lib/types"

// 1件の条件を自然な日本語1行に整形する。
//   例）「気温 が 30 ℃ 以上」「季節 が [春, 夏] のいずれか」「長さ が 0.5〜0.8 m の範囲」
export function formatRelationCondition(c: RelationCondition): string {
  const variable = c.variable || "(変数名なし)"
  const unit = c.unit ? ` ${c.unit}` : ""
  switch (c.operator) {
    case "eq":
      return `${variable} が ${c.value ?? ""}${unit}`
    case "ne":
      return `${variable} が ${c.value ?? ""}${unit} ではない`
    case "gt":
      return `${variable} が ${c.value ?? ""}${unit} より大きい`
    case "gte":
      return `${variable} が ${c.value ?? ""}${unit} 以上`
    case "lt":
      return `${variable} が ${c.value ?? ""}${unit} より小さい`
    case "lte":
      return `${variable} が ${c.value ?? ""}${unit} 以下`
    case "between":
      return `${variable} が ${c.valueMin ?? ""}〜${c.valueMax ?? ""}${unit} の範囲`
    case "notBetween":
      return `${variable} が ${c.valueMin ?? ""}〜${c.valueMax ?? ""}${unit} の範囲外`
    case "in":
      return `${variable} が [${(c.values ?? []).join(", ")}]${unit} のいずれか`
    case "notIn":
      return `${variable} が [${(c.values ?? []).join(", ")}]${unit} のいずれでもない`
    default:
      return `${variable} ${c.operator} ${c.value ?? ""}${unit}`
  }
}

// 全条件を改行区切りで整形（各行は自然文。前後の連結子は付けない：呼び出し側の
// 見出しが「すべて満たす場合」と明示しているため、AND 表現は暗黙）。
export function formatRelationConditions(list: RelationCondition[] | undefined): string {
  if (!list || list.length === 0) return ""
  return list.map((c) => formatRelationCondition(c)).join("\n")
}

// 条件が「実質的に設定されているか」（空配列は「なし」扱い）
export function hasConditions(list: RelationCondition[] | undefined): boolean {
  return !!list && list.length > 0
}
