// リレーション成立条件の表示用フォーマッタ。
//   一覧のツールチップ／グラフのホバー表示など、UIから共通で使う。

import type { RelationCondition, RelationConditionOperator } from "@/lib/types"

const OPERATOR_SYMBOL: Record<RelationConditionOperator, string> = {
  eq: "＝",
  ne: "≠",
  gt: "＞",
  gte: "≥",
  lt: "＜",
  lte: "≤",
  between: "範囲内",
  notBetween: "範囲外",
  in: "IN",
  notIn: "NOT IN",
}

// 1件の条件を1行の文字列に整形する。例）"変数名 ≥ 30 単位" / "変数名 範囲内 0.5〜0.8 単位"
export function formatRelationCondition(c: RelationCondition): string {
  const variable = c.variable || "(変数名なし)"
  const sym = OPERATOR_SYMBOL[c.operator] ?? c.operator
  const unit = c.unit ? ` ${c.unit}` : ""
  if (c.operator === "between" || c.operator === "notBetween") {
    const lo = c.valueMin ?? ""
    const hi = c.valueMax ?? ""
    return `${variable} ${sym} ${lo}〜${hi}${unit}`
  }
  if (c.operator === "in" || c.operator === "notIn") {
    const vs = (c.values ?? []).join(", ")
    return `${variable} ${sym} [${vs}]${unit}`
  }
  return `${variable} ${sym} ${c.value ?? ""}${unit}`
}

// 全条件を "IF ... AND ..." 形式のテキストに（1行1条件、改行区切り）
export function formatRelationConditions(list: RelationCondition[] | undefined): string {
  if (!list || list.length === 0) return ""
  return list
    .map((c, i) => `${i === 0 ? "IF" : "AND"} ${formatRelationCondition(c)}`)
    .join("\n")
}

// 条件が「実質的に設定されているか」（空配列は「なし」扱い）
export function hasConditions(list: RelationCondition[] | undefined): boolean {
  return !!list && list.length > 0
}
