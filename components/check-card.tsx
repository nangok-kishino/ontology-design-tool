"use client"

// チェック結果1件分の折りたたみカード。エクスポート前チェックと、
// グラフデータ確認の「使われていない定義」で同じ見た目にする。

import { Badge } from "@/components/ui/badge"
import type { CheckResult } from "@/lib/graph-cypher"
import { AlertTriangle, Check, ChevronDown, ChevronRight, Info } from "lucide-react"

export function CheckCard({
  check: c,
  info,
  open,
  onToggle,
}: {
  check: CheckResult
  // 参考情報（info）は警告の印を出さない
  info: boolean
  open: boolean
  onToggle: () => void
}) {
  const clean = c.items.length === 0
  return (
    <div className="rounded-lg border border-border">
      <button type="button"
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
        onClick={onToggle}
        disabled={clean}>
        {clean ? (
          <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-500" />
        ) : info ? (
          <Info className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : c.blocking ? (
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
        ) : (
          <AlertTriangle className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-foreground">{c.title}</span>
          <span className="block text-xs text-muted-foreground">{c.description}</span>
        </span>
        <Badge
          variant={clean || info ? "secondary" : c.blocking ? "default" : "outline"}
          className="shrink-0 font-normal">
          {clean ? "なし" : `${c.items.length}件`}
        </Badge>
        {!clean && (open
          ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />)}
      </button>
      {open && !clean && (
        <div className="max-h-64 overflow-y-auto border-t border-border">
          {c.items.map((item) => (
            <div key={item.id}
              className="flex items-baseline gap-2 border-b border-border/60 px-3 py-1.5 last:border-b-0">
              <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={item.name}>
                {item.name}
              </span>
              {item.detail && (
                <span className="shrink-0 text-xs text-muted-foreground">{item.detail}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// 開いているカードの key を持つ。押すたびに開閉する。
export function toggleKey(set: Set<string>, key: string): Set<string> {
  const next = new Set(set)
  next.has(key) ? next.delete(key) : next.add(key)
  return next
}
