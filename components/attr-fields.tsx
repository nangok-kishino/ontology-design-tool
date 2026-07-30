"use client"

// 属性値の入力フィールド群。インスタンス管理の詳細ペインと同じ作法・見た目を共有する
// （独自UIを増やさないため、instances-screen と同一のマークアップ・クラスを用いる）。

import { useState } from "react"
import { createPortal } from "react-dom"
import { Label } from "@/components/ui/label"
import { Info } from "lucide-react"
import type { OntologyAttribute } from "@/lib/types"

// ダイアログ内でも確実に動作するツールチップ（base-ui Tooltip は inert 問題あり）
export function InfoTooltip({ content }: { content: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  return (
    <>
      <span
        className="inline-flex cursor-help"
        onMouseEnter={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setPos({ x: r.left + r.width / 2, y: r.top - 6 })
        }}
        onMouseLeave={() => setPos(null)}
      >
        <Info className="h-3.5 w-3.5 text-muted-foreground/50 transition-colors hover:text-muted-foreground" />
      </span>
      {pos &&
        createPortal(
          <div
            className="pointer-events-none rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs leading-relaxed text-popover-foreground shadow-lg"
            style={{
              position: "fixed",
              left: pos.x,
              top: pos.y,
              transform: "translate(-50%, -100%)",
              zIndex: 9999,
              maxWidth: "13rem",
            }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  )
}

const DATA_TYPE_LABELS: Record<string, string> = {
  "文字列": "文字列型",
  "数値": "数値型",
  "日付": "日付型",
  "日時": "日付型",
  "真偽値": "真偽値型",
}

export function dataTypeLabel(dataType: string): string {
  return DATA_TYPE_LABELS[dataType] ?? `${dataType}型`
}

const inputCls =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"

export function AttrInput({
  attr,
  value,
  onChange,
}: {
  attr: OntologyAttribute
  value: string
  onChange: (v: string) => void
}) {
  const isDate = attr.dataType === "日付" || attr.dataType === "日時"
  if (attr.dataType === "真偽値") {
    return (
      <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">選択してください</option>
        <option value="true">はい</option>
        <option value="false">いいえ</option>
      </select>
    )
  }
  if (isDate) {
    return <input type="date" className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} />
  }
  if (attr.dataType === "数値") {
    return (
      <input
        type="number"
        step="any"
        className={inputCls}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        onWheel={(e) => (e.target as HTMLInputElement).blur()}
      />
    )
  }
  return (
    <input
      type="text"
      className={inputCls}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={`${attr.name}を入力`}
    />
  )
}

// 属性値の入力リスト（見出し＋型ラベル＋説明ツールチップ＋入力）。空配列なら null。
export function AttrValueList({
  attrs,
  values,
  onChange,
}: {
  attrs: OntologyAttribute[]
  values: Record<string, string>
  onChange: (id: string, v: string) => void
}) {
  if (attrs.length === 0) return null
  return (
    <div className="space-y-3">
      {attrs.map((attr) => (
        <div key={attr.id} className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Label className="text-sm font-medium">
              {attr.name}
              {attr.required === "必須" && <span className="ml-0.5 text-destructive">*</span>}
            </Label>
            <span className="text-xs text-muted-foreground">（{dataTypeLabel(attr.dataType)}）</span>
            {attr.description && <InfoTooltip content={attr.description} />}
          </div>
          <AttrInput attr={attr} value={values[attr.id] ?? ""} onChange={(v) => onChange(attr.id, v)} />
        </div>
      ))}
    </div>
  )
}

export function hasMissingRequired(attrs: OntologyAttribute[], values: Record<string, string>): boolean {
  return attrs.some((a) => a.required === "必須" && !(values[a.id] ?? "").trim())
}
