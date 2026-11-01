"use client"

// ラベルの見た目。アプリ全体でこれ1つに揃える。
//   ノードに付いたラベル、リレーションシップタイプのラベルペア、ノード詳細の付け外し欄など、
//   「ラベル」を画面に出すところはすべてこれを使う。
//   同じものが場所によって違う見た目で出ていると、同じものだと気づけないため。

import { X } from "lucide-react"
import { cn } from "@/lib/utils"

export function LabelChip({
  name,
  icon,
  onRemove,
  className,
}: {
  name: string
  // 予約ラベルの鍵アイコンなど、名前の前に置く小さな印
  icon?: React.ReactNode
  // 外せるときだけ × を出す
  onRemove?: () => void
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
        "border-indigo-200 bg-indigo-50 text-indigo-900",
        "dark:border-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-200",
        className,
      )}
      title={name}
    >
      {icon}
      <span className="truncate">{name}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={`${name}を外す`}
          className="shrink-0 rounded-full text-indigo-500 transition-colors hover:bg-indigo-200/70 hover:text-indigo-900 dark:text-indigo-300 dark:hover:bg-indigo-900"
          onClick={(e) => { e.stopPropagation(); onRemove() }}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  )
}

// ラベルを並べて出す。付いていないときは「—」。
export function LabelChips({
  names,
  className,
}: {
  names: string[]
  className?: string
}) {
  if (names.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>
  }
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {names.map((name, i) => (
        <LabelChip key={`${name}:${i}`} name={name} />
      ))}
    </div>
  )
}
