"use client"

// 同じタイプのリレーションシップを複数選んだときの右ペイン（グラフデータ確認で使う）。
// 編集はせず、選んだ全件で共通の内容だけを見せる（一括で書き換えて事故にならないように）。
// 1件ずつ直したいときは、一覧から1件を選ぶと通常の詳細パネルに切り替わる。

import { useMemo } from "react"
import { FileText, Filter, Tags, X } from "lucide-react"
import { SectionHeader } from "@/components/section-header"
import { conditionSetsOf } from "@/lib/graph-types"
import { formatCondition } from "@/lib/relation-conditions"
import { cn } from "@/lib/utils"
import type { PropertyDef, Relationship, RelationshipType } from "@/lib/graph-types"

// 中身が同じかを比べるための文字列（キーの順に左右されないよう並べ替える）
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${k}:${canon((v as Record<string, unknown>)[k])}`).join(",")}}`
  }
  return JSON.stringify(v ?? null)
}

function Differs({ text = "件ごとに異なります" }: { text?: string }) {
  return (
    <p className="rounded-lg border border-dashed border-border py-3 text-center text-xs text-muted-foreground">{text}</p>
  )
}

export function RelationshipGroupPanel({
  relationships: rels,
  relType,
  propertyDefs,
  nodeName,
  onPick,
  onClose,
  className,
}: {
  relationships: Relationship[] // 選んだもの（2件以上・同じタイプ）
  relType: RelationshipType | null
  propertyDefs: PropertyDef[]
  nodeName: (id: string) => string
  onPick: (id: string) => void // 一覧の1件を押したとき（その1件だけを選ぶ）
  onClose: () => void
  className?: string
}) {
  const slots = relType?.conditions ?? []

  // 成立条件：全件で同じならその条件セット、違えば null
  const commonConditionSets = useMemo(() => {
    const first = conditionSetsOf(rels[0])
    const key = canon(first)
    return rels.every((r) => canon(conditionSetsOf(r)) === key) ? first : null
  }, [rels])

  // 根拠：全件で同じならその文、違えば null
  const commonEvidence = useMemo(() => {
    const first = rels[0].evidence ?? ""
    return rels.every((r) => (r.evidence ?? "") === first) ? first : null
  }, [rels])

  // このタイプが持てるプロパティ（詳細パネルと同じ選び方）
  const props = useMemo(() => {
    const picked = new Map<string, PropertyDef>()
    for (const p of propertyDefs) {
      const belongs = p.targetType === "project" ||
        (p.targetType === "relationshipType" && p.targetId === rels[0].relTypeId)
      if (belongs && !picked.has(p.name)) picked.set(p.name, p)
    }
    return [...picked.values()].sort((a, b) => a.name.localeCompare(b.name, "ja"))
  }, [propertyDefs, rels])

  return (
    <div className={cn("flex w-[30rem] shrink-0 flex-col overflow-hidden bg-card", className)}>
      <div className="space-y-2 border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold text-foreground">
            {rels[0].relTypeName}（{rels.length}件を選択中）
          </span>
          <button type="button" aria-label="詳細を閉じる"
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted"
            onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground">1件を押すと、そのリレーションシップだけを選んで編集できます</p>
        <div className="max-h-48 overflow-y-auto rounded-lg border border-border">
          {rels.map((r) => (
            <button key={r.id} type="button"
              className="block w-full truncate px-2.5 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-muted"
              onClick={() => onPick(r.id)}>
              {nodeName(r.startNodeId)} → {nodeName(r.endNodeId)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
        <p className="text-xs text-muted-foreground">
          選んだ{rels.length}件で共通の内容です。ここでは編集できません。
        </p>

        <section className="space-y-3">
          <SectionHeader icon={FileText} title="根拠" />
          {commonEvidence === null ? <Differs />
            : commonEvidence === "" ? <Differs text="未入力" />
            : <p className="whitespace-pre-wrap rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-foreground">{commonEvidence}</p>}
        </section>

        <section className="space-y-3">
          <SectionHeader icon={Filter} title="成立条件" />
          {slots.length === 0 ? (
            <Differs text={`「${rels[0].relTypeName}」に条件項目が定義されていません（常に成立）`} />
          ) : commonConditionSets === null ? <Differs />
            : commonConditionSets.length === 0 ? <Differs text="条件セットなし（常に成立）" />
            : (
              <div className="space-y-2">
                {commonConditionSets.map((set, i) => {
                  const lines = slots.filter((s) => set[s.id]).map((s) => formatCondition(s, set[s.id]))
                  return (
                    <div key={i} className="space-y-2">
                      {i > 0 && <p className="text-center text-xs font-medium text-muted-foreground">または</p>}
                      <div className="space-y-1 rounded-lg border border-border p-2.5">
                        <span className="text-xs font-semibold text-foreground">条件セット{i + 1}</span>
                        {lines.length === 0
                          ? <p className="text-xs text-muted-foreground">条件なし</p>
                          : lines.map((l, j) => <p key={j} className="text-sm text-foreground">{l}</p>)}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
        </section>

        <section className="space-y-3">
          <SectionHeader icon={Tags} title="プロパティ" />
          {props.length === 0 ? (
            <Differs text="このタイプにプロパティが定義されていません" />
          ) : (
            <dl className="divide-y divide-border rounded-lg border border-border">
              {props.map((p) => {
                const values = new Set(rels.map((r) => r.properties?.[p.name] ?? ""))
                const only = values.size === 1 ? [...values][0] : null
                return (
                  <div key={p.id} className="flex gap-3 px-3 py-2 text-sm">
                    <dt className="w-32 shrink-0 text-muted-foreground">{p.name}</dt>
                    <dd className={cn("min-w-0 flex-1 break-words", only ? "text-foreground" : "text-muted-foreground")}>
                      {only === null ? `異なる値（${values.size}種類）` : only === "" ? "未入力" : only}
                    </dd>
                  </div>
                )
              })}
            </dl>
          )}
        </section>
      </div>
    </div>
  )
}
