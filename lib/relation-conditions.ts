// 成立条件まわりの共通処理。
//
// 条件は2つに分かれている。
//   条件項目（RelationConditionSlot）: リレーションが宣言する「何についての条件か」。
//                                      対象データ名と単位だけで、具体値は持たない。
//   条件の値（ConditionValue）        : トリプレット1件ごとの「演算子と値」。
// 属性と同じ分担で、定義はリレーション、値はトリプレットにある。
//
// 整形（formatCondition）は UI 共通。一覧のツールチップ、グラフのホバー表示で使う。

import type {
  ConditionValue,
  LegacyRelationCondition,
  RelationConditionOperator,
  RelationConditionSlot,
  TripletConditions,
} from "@/lib/types"

export const isRangeOperator = (op: RelationConditionOperator) => op === "between" || op === "notBetween"
export const isSetOperator = (op: RelationConditionOperator) => op === "in" || op === "notIn"
export const isScalarOperator = (op: RelationConditionOperator) => !isRangeOperator(op) && !isSetOperator(op)

// 成立条件の演算子カタログ（表示ラベル・略記号・分類）
export const CONDITION_OPERATORS: {
  value: RelationConditionOperator
  symbol: string
  label: string
  group: "比較" | "範囲" | "集合"
}[] = [
  { value: "eq", symbol: "＝", label: "に等しい", group: "比較" },
  { value: "ne", symbol: "≠", label: "に等しくない", group: "比較" },
  { value: "gte", symbol: "≥", label: "以上", group: "比較" },
  { value: "gt", symbol: "＞", label: "より大きい", group: "比較" },
  { value: "lte", symbol: "≤", label: "以下", group: "比較" },
  { value: "lt", symbol: "＜", label: "より小さい", group: "比較" },
  { value: "between", symbol: "範囲内", label: "下限〜上限（両端含む）", group: "範囲" },
  { value: "notBetween", symbol: "範囲外", label: "下限〜上限（両端含む）", group: "範囲" },
  { value: "in", symbol: "IN", label: "いずれかに一致", group: "集合" },
  { value: "notIn", symbol: "NOT IN", label: "いずれにも一致しない", group: "集合" },
]

export const DEFAULT_CONDITION_VALUE: ConditionValue = { operator: "gte", value: "" }

// 1件の条件を自然な日本語1行に整形する。
//   例）「気温 が 30 ℃ 以上」「季節 が [春, 夏] のいずれか」「長さ が 0.5〜0.8 m の範囲」
export function formatCondition(
  slot: { variable: string; unit?: string } | undefined,
  v: ConditionValue,
): string {
  const variable = slot?.variable || "(対象データ名なし)"
  const unit = slot?.unit ? ` ${slot.unit}` : ""
  switch (v.operator) {
    case "eq":
      return `${variable} が ${v.value ?? ""}${unit}`
    case "ne":
      return `${variable} が ${v.value ?? ""}${unit} ではない`
    case "gt":
      return `${variable} が ${v.value ?? ""}${unit} より大きい`
    case "gte":
      return `${variable} が ${v.value ?? ""}${unit} 以上`
    case "lt":
      return `${variable} が ${v.value ?? ""}${unit} より小さい`
    case "lte":
      return `${variable} が ${v.value ?? ""}${unit} 以下`
    case "between":
      return `${variable} が ${v.valueMin ?? ""}〜${v.valueMax ?? ""}${unit} の範囲`
    case "notBetween":
      return `${variable} が ${v.valueMin ?? ""}〜${v.valueMax ?? ""}${unit} の範囲外`
    case "in":
      return `${variable} が [${(v.values ?? []).join(", ")}]${unit} のいずれか`
    case "notIn":
      return `${variable} が [${(v.values ?? []).join(", ")}]${unit} のいずれでもない`
    default:
      return `${variable} ${v.operator} ${v.value ?? ""}${unit}`
  }
}

// トリプレットが持つ条件を、条件項目の宣言順に整形して並べる。
// 既に消えた条件項目を指している分は出さない（定義が主、値は従）。
export function formatTripletConditions(
  slots: RelationConditionSlot[] | undefined,
  conditions: TripletConditions | undefined,
): string[] {
  if (!slots || !conditions) return []
  return slots
    .filter((slot) => conditions[slot.id])
    .map((slot) => formatCondition(slot, conditions[slot.id]))
}

// 条件が「実質的に設定されているか」（空は「なし」扱い）
export function hasConditionSlots(list: RelationConditionSlot[] | undefined): boolean {
  return !!list && list.length > 0
}
export function countTripletConditions(
  slots: RelationConditionSlot[] | undefined,
  conditions: TripletConditions | undefined,
): number {
  if (!slots || !conditions) return 0
  return slots.filter((slot) => conditions[slot.id]).length
}

// 演算子に要る値が埋まっているか
export function conditionValueComplete(v: ConditionValue): boolean {
  if (isRangeOperator(v.operator)) return (v.valueMin ?? "").trim() !== "" && (v.valueMax ?? "").trim() !== ""
  if (isSetOperator(v.operator)) return (v.values ?? []).length > 0
  return (v.value ?? "").trim() !== ""
}

// 保存前の正規化（trim・演算子に要らないフィールドの除去）
export function normalizeConditionValue(v: ConditionValue): ConditionValue {
  const base: ConditionValue = { operator: v.operator }
  if (isRangeOperator(v.operator)) {
    base.valueMin = (v.valueMin ?? "").trim()
    base.valueMax = (v.valueMax ?? "").trim()
  } else if (isSetOperator(v.operator)) {
    base.values = (v.values ?? []).map((x) => x.trim()).filter((x) => x.length > 0)
  } else {
    base.value = (v.value ?? "").trim()
  }
  return base
}

// 値が入っていない項目は落として保存する（「使わない」と同じ扱いにする）
export function normalizeTripletConditions(conditions: TripletConditions | undefined): TripletConditions {
  const out: TripletConditions = {}
  for (const [id, v] of Object.entries(conditions ?? {})) {
    if (!v || typeof v.operator !== "string") continue
    const n = normalizeConditionValue(v)
    if (conditionValueComplete(n)) out[id] = n
  }
  return out
}

// 条件項目の正規化。対象データ名が空のものは落とし、id が無ければ振る。
export function normalizeConditionSlots(list: unknown): RelationConditionSlot[] {
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const out: RelationConditionSlot[] = []
  for (const raw of list) {
    const variable = String((raw as any)?.variable ?? "").trim()
    if (!variable) continue
    let id = String((raw as any)?.id ?? "").trim()
    if (!id || seen.has(id)) id = crypto.randomUUID()
    seen.add(id)
    const slot: RelationConditionSlot = { id, variable }
    const unit = String((raw as any)?.unit ?? "").trim()
    if (unit) slot.unit = unit
    const description = String((raw as any)?.description ?? "").trim()
    if (description) slot.description = description
    const legacyText = String((raw as any)?.legacyText ?? "").trim()
    if (legacyText) slot.legacyText = legacyText
    out.push(slot)
  }
  return out
}

// 文字列から安定した短いキーを作る（FNV-1a）。
// 具体値をリレーションに持たせていた頃のデータに、読むたびに変わらない id を与えるため。
function stableKey(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, "0")
}

// 旧形式（具体値つき）の条件を条件項目へ読み替える。
// 対象データ名と単位だけを引き継ぎ、演算子と値は legacyText（読み取り専用の参考表示）に畳む。
// 保存せずに読み取り時だけ変換するので、id は内容から決めて読むたびに変わらないようにする。
export function migrateLegacyConditions(list: unknown): RelationConditionSlot[] {
  if (!Array.isArray(list)) return []
  const out: RelationConditionSlot[] = []
  const seen = new Set<string>()
  for (const raw of list) {
    const item = raw as Partial<RelationConditionSlot> & Partial<LegacyRelationCondition>
    // すでに新形式（id を持ち、具体値を持たない）ならそのまま
    if (item?.id && !item?.operator) {
      out.push(...normalizeConditionSlots([item]))
      continue
    }
    const variable = String(item?.variable ?? "").trim()
    if (!variable) continue
    const unit = String(item?.unit ?? "").trim()
    const legacy = item as LegacyRelationCondition
    const legacyText = legacy.operator
      ? formatCondition({ variable, unit: unit || undefined }, legacy)
      : ""
    let id = `legacy-${stableKey(`${variable}|${unit}|${legacyText}`)}`
    while (seen.has(id)) id = `${id}x`
    seen.add(id)
    const slot: RelationConditionSlot = { id, variable }
    if (unit) slot.unit = unit
    if (legacyText) slot.legacyText = legacyText
    out.push(slot)
  }
  return out
}
