"use client"

// 同義語のチップ入力。Enter（または「、」「,」）で追加、× で削除、空欄で Backspace なら末尾を削除。
//   重複（正規化一致）や自クラス名と同じ語は追加しない。最終的な整形・重複チェックはサーバ側でも行う。

import { useState } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { normalizeName } from "@/lib/normalize"

export function SynonymInput({
  value,
  onChange,
  ownName,
  placeholder = "例：製品（Enterで追加）",
  className,
}: {
  value: string[]
  onChange: (next: string[]) => void
  ownName?: string
  placeholder?: string
  className?: string
}) {
  const [draft, setDraft] = useState("")

  const add = (raw: string) => {
    const terms = raw.split(/[、,，]/).map((t) => t.trim()).filter(Boolean)
    if (terms.length === 0) return
    const seen = new Set(value.map((v) => normalizeName(v)))
    if (ownName) seen.add(normalizeName(ownName))
    const next = [...value]
    for (const t of terms) {
      const key = normalizeName(t)
      if (!key || seen.has(key)) continue
      seen.add(key)
      next.push(t)
    }
    onChange(next)
    setDraft("")
  }

  return (
    <div
      className={cn(
        "flex min-h-8 w-full flex-wrap items-center gap-1 rounded-lg border border-input px-1.5 py-1 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
        className,
      )}
    >
      {value.map((v) => (
        <span key={v} className="flex items-center gap-0.5 rounded-md bg-muted px-1.5 py-0.5 text-xs">
          {v}
          <button
            type="button"
            aria-label={`同義語「${v}」を削除`}
            onClick={() => onChange(value.filter((x) => x !== v))}
            className="rounded text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => {
          const t = e.target.value
          if (/[、,，]$/.test(t)) add(t)
          else setDraft(t)
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault()
            add(draft)
          } else if (e.key === "Backspace" && !draft && value.length > 0) {
            onChange(value.slice(0, -1))
          }
        }}
        onBlur={() => draft.trim() && add(draft)}
        placeholder={value.length === 0 ? placeholder : ""}
        className="min-w-24 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  )
}
