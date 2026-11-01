"use client"

// トリプレット1件の成立条件を入れる欄。
//
// 並ぶ項目は、述語に選んだリレーションが宣言した条件項目（対象データ名・単位）。
// 「使う」に印を付けたものだけが条件になり、演算子と値はここで決める。
// リレーション側は項目を決めるだけで、具体値は持たない（lib/relation-conditions.ts 参照）。

import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import {
  CONDITION_OPERATORS,
  DEFAULT_CONDITION_VALUE,
  conditionValueComplete,
  isRangeOperator,
  isSetOperator,
} from "@/lib/relation-conditions"
import type { ConditionValue, RelationConditionOperator, RelationConditionSlot, TripletConditions } from "@/lib/types"

// 集合演算子の入力欄（カンマ区切り）↔ values 配列
const parseValues = (text: string): string[] =>
  text.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
const formatValues = (vs: string[] | undefined) => (vs ?? []).join(", ")

// 使う印を付けた条件のうち、値が埋まっていないものがあるか（保存の可否判定に使う）
export function hasIncompleteConditions(
  slots: RelationConditionSlot[] | undefined,
  values: TripletConditions,
): boolean {
  return (slots ?? []).some((slot) => {
    const v = values[slot.id]
    return !!v && !conditionValueComplete(v)
  })
}

export function ConditionValueList({
  slots,
  values,
  onChange,
}: {
  slots: RelationConditionSlot[]
  values: TripletConditions
  onChange: (next: TripletConditions) => void
}) {
  const setValue = (id: string, patch: Partial<ConditionValue>) => {
    const current = values[id] ?? DEFAULT_CONDITION_VALUE
    const merged: ConditionValue = { ...current, ...patch }
    // 演算子の種類が変わったら、値の欄を演算子に合わせて入れ替える
    if (patch.operator !== undefined) {
      const op = patch.operator
      if (isRangeOperator(op)) {
        merged.value = undefined
        merged.values = undefined
        merged.valueMin = merged.valueMin ?? ""
        merged.valueMax = merged.valueMax ?? ""
      } else if (isSetOperator(op)) {
        merged.value = undefined
        merged.valueMin = undefined
        merged.valueMax = undefined
        merged.values = merged.values ?? []
      } else {
        merged.valueMin = undefined
        merged.valueMax = undefined
        merged.values = undefined
        merged.value = merged.value ?? ""
      }
    }
    onChange({ ...values, [id]: merged })
  }

  const toggle = (id: string, on: boolean) => {
    if (on) {
      onChange({ ...values, [id]: values[id] ?? { ...DEFAULT_CONDITION_VALUE } })
      return
    }
    const next = { ...values }
    delete next[id]
    onChange(next)
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">
        使う条件に印を付けて値を入れてください。印を付けた条件を
        <strong className="font-medium text-foreground">すべて満たす場合</strong>に成立します。
      </p>
      <div className="space-y-2">
        {slots.map((slot) => {
          const v = values[slot.id]
          const on = !!v
          return (
            <div
              key={slot.id}
              className={cn(
                "rounded-md border px-2.5 py-2 transition-colors",
                on ? "border-border bg-muted/30" : "border-dashed border-border",
              )}
            >
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={on}
                  aria-label={`${slot.variable}を条件に使う`}
                  onChange={(e) => toggle(slot.id, e.target.checked)}
                />
                <span className={cn("text-sm font-medium", on ? "text-foreground" : "text-muted-foreground")}>
                  {slot.variable}
                </span>
                {slot.unit && <span className="text-xs text-muted-foreground">（{slot.unit}）</span>}
                {!on && <span className="ml-auto text-[11px] text-muted-foreground">使わない</span>}
              </label>
              {slot.description && (
                <p className="mt-1 pl-6 text-[11px] text-muted-foreground">{slot.description}</p>
              )}
              {on && (
                <div className="mt-2 flex items-center gap-1.5 pl-6">
                  <Select
                    value={v.operator}
                    onValueChange={(nv) => nv && setValue(slot.id, { operator: nv as RelationConditionOperator })}
                  >
                    <SelectTrigger className="h-8 w-24 shrink-0">
                      <SelectValue>
                        {CONDITION_OPERATORS.find((o) => o.value === v.operator)?.symbol ?? v.operator}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {CONDITION_OPERATORS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          <span className="inline-block w-16 font-mono">{o.symbol}</span>
                          <span className="text-muted-foreground">{o.label}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {isRangeOperator(v.operator) ? (
                    <div className="flex min-w-0 flex-1 items-center gap-1">
                      <Input
                        className="h-8 min-w-0 flex-1"
                        placeholder="下限"
                        value={v.valueMin ?? ""}
                        onChange={(e) => setValue(slot.id, { valueMin: e.target.value })}
                      />
                      <span className="shrink-0 text-xs text-muted-foreground">〜</span>
                      <Input
                        className="h-8 min-w-0 flex-1"
                        placeholder="上限"
                        value={v.valueMax ?? ""}
                        onChange={(e) => setValue(slot.id, { valueMax: e.target.value })}
                      />
                    </div>
                  ) : isSetOperator(v.operator) ? (
                    <Input
                      className="h-8 min-w-0 flex-1"
                      placeholder="値1, 値2, ... (カンマ区切り)"
                      value={formatValues(v.values)}
                      onChange={(e) => setValue(slot.id, { values: parseValues(e.target.value) })}
                    />
                  ) : (
                    <Input
                      className="h-8 min-w-0 flex-1"
                      placeholder="値"
                      value={v.value ?? ""}
                      onChange={(e) => setValue(slot.id, { value: e.target.value })}
                    />
                  )}
                  {slot.unit && <span className="shrink-0 text-xs text-muted-foreground">{slot.unit}</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
