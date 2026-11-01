"use client"

// プロパティまわりの部品。
//   - プロパティ欄（定義の追加・編集・削除）：ラベル管理／リレーションシップタイプ管理の右ペイン
//   - 値の入力欄：ノード管理／リレーションシップ管理の右ペイン
//
// 【値のキーは「プロパティ名」】ノードやリレーションシップに入っている値は、
// 定義の id ではなく名前で引く（Neo4j のプロパティと同じ）。そのため
//   - 同じ持ち主に同名のプロパティは作れない
//   - 名前を変えると、既に入っている値のキーもサーバ側で付け替わる
// という扱いになる。詳しくは docs/graph-model.md。

import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label as FieldLabel } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip } from "@/components/ui/tooltip"
import { Info, Loader2, Pencil, Plus, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { PropertyDef, PropertyRequired, PropertyTarget } from "@/lib/graph-types"

export const DATA_TYPES = ["文字列", "数値", "日付", "真偽値"] as const

const DATA_TYPE_LABELS: Record<string, string> = {
  "文字列": "文字列型", "数値": "数値型", "日付": "日付型", "日時": "日付型", "真偽値": "真偽値型",
}
export function dataTypeLabel(dataType: string): string {
  return DATA_TYPE_LABELS[dataType] ?? `${dataType}型`
}

const inputCls =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"

// プロパティ1件分の入力欄。データ型に合わせて入力の種類を変える。
export function PropertyInput({
  property,
  value,
  onChange,
}: {
  property: PropertyDef
  value: string
  onChange: (v: string) => void
}) {
  if (property.dataType === "真偽値") {
    return (
      <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">選択してください</option>
        <option value="true">はい</option>
        <option value="false">いいえ</option>
      </select>
    )
  }
  if (property.dataType === "日付" || property.dataType === "日時") {
    return <input type="date" className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} />
  }
  if (property.dataType === "数値") {
    return (
      <input type="number" step="any" className={inputCls} value={value} placeholder="0"
        onChange={(e) => onChange(e.target.value)}
        onWheel={(e) => (e.target as HTMLInputElement).blur()} />
    )
  }
  return (
    <input type="text" className={inputCls} value={value} placeholder={`${property.name}を入力`}
      onChange={(e) => onChange(e.target.value)} />
  )
}

// プロパティ値の入力リスト。【キーはプロパティ名】なので、同名のプロパティが
// 複数のラベルに定義されていても、入力欄は1つにまとまる。
export function PropertyValueList({
  properties,
  values,
  sources,
  onChange,
}: {
  properties: PropertyDef[]
  values: Record<string, string>
  // プロパティ名 → それがどこ（ラベル名など）から来ているか。
  // ノードは複数のラベルを持つので、どのラベル由来かが分からないと直しどころが掴めない。
  sources?: Record<string, string>
  onChange: (name: string, v: string) => void
}) {
  if (properties.length === 0) return null
  return (
    <div className="space-y-3">
      {properties.map((p) => (
        <div key={p.id} className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <FieldLabel className="text-sm font-medium">
              {p.name}
              {p.required === "必須" && <span className="ml-0.5 text-destructive">*</span>}
            </FieldLabel>
            <span className="text-xs text-muted-foreground">（{dataTypeLabel(p.dataType)}）</span>
            {p.description && (
              <Tooltip content={p.description}>
                <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground/50" />
              </Tooltip>
            )}
            {sources?.[p.name] && (
              <span className="ml-auto shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {sources[p.name]}
              </span>
            )}
          </div>
          <PropertyInput property={p} value={values[p.name] ?? ""} onChange={(v) => onChange(p.name, v)} />
        </div>
      ))}
    </div>
  )
}

export function hasMissingRequired(properties: PropertyDef[], values: Record<string, string>): boolean {
  return properties.some((p) => p.required === "必須" && !(values[p.name] ?? "").trim())
}

// ─────────────────────────────────────────────
// プロパティ欄（右ペイン用）
//
// 【保存は右ペインの「保存」ボタンでまとめて行う】
//   ここでの追加・編集・削除はすぐには書き込まず、保留として持つ。
//   右ペインは1枚の編集フォームなので、何が保存済みで何が未保存かは
//   下の「保存」1か所で分かるようにする（項目ごとに保存のされ方が違うと、
//   押せない保存ボタンを見て「編集できない」と受け取られるため）。
//   親は ref の commit() を保存時に呼び、onDirtyChange で未保存の有無を受け取る。
// ─────────────────────────────────────────────

// 保留中の1行。original があれば既存の定義、無ければ新規。
type DraftRow = {
  key: string
  original?: PropertyDef
  name: string
  dataType: string
  required: PropertyRequired
  // 削除予定。値をどうするかは削除を決めた時点で選んでもらう
  deleted?: { removeValues: boolean }
}

const rowStatus = (r: DraftRow): "new" | "edited" | "deleted" | "same" => {
  if (r.deleted) return "deleted"
  if (!r.original) return "new"
  const o = r.original
  return o.name !== r.name || o.dataType !== r.dataType || o.required !== r.required ? "edited" : "same"
}

const toDraft = (p: PropertyDef): DraftRow => ({
  key: p.id, original: p, name: p.name, dataType: p.dataType, required: p.required,
})

export type PropertySectionHandle = {
  // 保留中の変更を書き込む。失敗したらエラーメッセージを投げる。
  commit: () => Promise<void>
}

// 追加・編集の入力欄（右ペイン内。説明は扱わない）
function PropertyRowEditor({
  initial,
  onApply,
  onCancel,
}: {
  initial?: DraftRow
  onApply: (v: { name: string; dataType: string; required: PropertyRequired }) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? "")
  const [dataType, setDataType] = useState<string>(initial?.dataType ?? "文字列")
  const [required, setRequired] = useState<PropertyRequired>(initial?.required ?? "任意")

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
      <p className="text-xs font-medium text-foreground">
        {initial ? "プロパティを編集" : "プロパティを追加"}
      </p>
      <div className="flex items-center gap-1.5">
        <Input className="h-8 min-w-0 flex-1" placeholder="キー名（例：図面名称）"
          value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <Select value={dataType} onValueChange={(v) => { if (v) setDataType(v) }}>
          <SelectTrigger className="h-8 w-24 shrink-0"><SelectValue>{dataType}</SelectValue></SelectTrigger>
          <SelectContent>
            {DATA_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={required} onValueChange={(v) => { if (v) setRequired(v as PropertyRequired) }}>
          <SelectTrigger className="h-8 w-20 shrink-0"><SelectValue>{required}</SelectValue></SelectTrigger>
          <SelectContent>
            <SelectItem value="必須">必須</SelectItem>
            <SelectItem value="任意">任意</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {initial?.original && name.trim() !== initial.original.name && (
        <p className="text-xs text-muted-foreground">
          キー名を変えると、保存時に既に入っている値のキーも一緒に付け替えます。
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" variant="ghost" className="h-7" onClick={onCancel}>キャンセル</Button>
        <Button size="sm" className="h-7" disabled={!name.trim()}
          onClick={() => onApply({ name: name.trim(), dataType, required })}>
          {initial ? "反映" : "追加"}
        </Button>
      </div>
    </div>
  )
}

// 既存の定義を削除予定にするとき、入っている値をどうするか選ぶダイアログ
function PropertyDeleteChoiceDialog({
  open,
  onOpenChange,
  name,
  valueCount,
  onChoose,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  name: string
  valueCount: number
  onChoose: (removeValues: boolean) => void
}) {
  const [mode, setMode] = useState<"keep" | "remove">("keep")
  useEffect(() => { if (open) setMode("keep") }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>プロパティを削除</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1 text-sm">
          <p>「{name}」を削除予定にします。右ペインの「保存」を押すと削除されます。</p>
          {valueCount > 0 ? (
            <>
              <p className="text-muted-foreground">このプロパティには {valueCount}件の値が入っています。値をどうしますか。</p>
              <div className="space-y-2">
                {([
                  { key: "keep", label: "値は残す", hint: "定義だけ消します。値はデータに残りますが、画面には出なくなります。" },
                  { key: "remove", label: "値も消す", hint: "入っている値も削除します。取り消せません。" },
                ] as { key: "keep" | "remove"; label: string; hint: string }[]).map((opt) => (
                  <label key={opt.key} className="flex cursor-pointer items-start gap-2 rounded-md border border-border px-3 py-2">
                    <input type="radio" name="prop-delete-mode" className="mt-1"
                      checked={mode === opt.key} onChange={() => setMode(opt.key)} />
                    <span>
                      <span className="block font-medium text-foreground">{opt.label}</span>
                      <span className="block text-xs text-muted-foreground">{opt.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">値はまだ入っていません。</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>キャンセル</Button>
          <Button variant="destructive" onClick={() => { onChoose(mode === "remove"); onOpenChange(false) }}>
            削除予定にする
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const STATUS_BADGE: Record<"new" | "edited" | "deleted", { label: string; className: string }> = {
  new: { label: "追加", className: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" },
  edited: { label: "変更", className: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300" },
  deleted: { label: "削除", className: "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300" },
}

export const PropertySection = forwardRef<PropertySectionHandle, {
  projectId: string
  targetType: PropertyTarget
  targetId: string
  // 表の下に出す補足文
  note?: string
  // 保留中の変更があるかどうか（親の「保存」ボタンを押せるようにするため）
  onDirtyChange?: (dirty: boolean) => void
}>(function PropertySection({ projectId, targetType, targetId, note, onDirtyChange }, ref) {
  const [rows, setRows] = useState<DraftRow[]>([])
  const [valueCounts, setValueCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  // 開いている入力欄：null＝閉じている、"new"＝追加、それ以外＝編集中の行の key
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [deletingKey, setDeletingKey] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!targetId) return
    setLoading(true)
    try {
      const [list, usage] = await Promise.all([
        fetch(`/api/properties?targetId=${targetId}`).then((r) => r.json()),
        fetch(`/api/properties/usage?projectId=${projectId}`).then((r) => r.json()).catch(() => null),
      ])
      const defs: PropertyDef[] = Array.isArray(list) ? list : []
      setRows(defs.sort((a, b) => a.name.localeCompare(b.name, "ja")).map(toDraft))
      const scope = targetType === "relationshipType" ? usage?.relationships : usage?.nodes
      setValueCounts(scope ?? {})
      setEditingKey(null)
    } finally {
      setLoading(false)
    }
  }, [targetId, projectId, targetType])

  useEffect(() => { refresh() }, [refresh])

  const dirty = rows.some((r) => rowStatus(r) !== "same")
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])

  useImperativeHandle(ref, () => ({
    commit: async () => {
      if (!dirty) return
      // 同じ持ち主に同名を2つ作らせない（値は名前で引くため）
      const alive = rows.filter((r) => !r.deleted)
      const names = alive.map((r) => r.name)
      const dup = names.find((n, i) => names.indexOf(n) !== i)
      if (dup) throw new Error(`プロパティ「${dup}」が重複しています`)

      const fail = async (res: Response, fallback: string) => {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? fallback)
      }
      // 削除 → 変更 → 追加 の順（消した名前を付け直す場合に衝突しないように）
      for (const r of rows.filter((x) => rowStatus(x) === "deleted" && x.original)) {
        const res = await fetch(
          `/api/properties/${r.original!.id}${r.deleted!.removeValues ? "?values=remove" : ""}`,
          { method: "DELETE" },
        )
        if (!res.ok) await fail(res, `「${r.name}」の削除に失敗しました`)
      }
      for (const r of rows.filter((x) => rowStatus(x) === "edited")) {
        // description は送らない＝既存の説明を残す
        const res = await fetch(`/api/properties/${r.original!.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: r.name, dataType: r.dataType, required: r.required }),
        })
        if (!res.ok) await fail(res, `「${r.name}」の更新に失敗しました`)
      }
      for (const r of rows.filter((x) => rowStatus(x) === "new")) {
        const res = await fetch("/api/properties", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId, name: r.name, dataType: r.dataType, required: r.required,
            targetType, targetId,
          }),
        })
        if (!res.ok) await fail(res, `「${r.name}」の追加に失敗しました`)
      }
      await refresh()
    },
  }), [dirty, rows, projectId, targetType, targetId, refresh])

  const applyEdit = (key: string | "new", v: { name: string; dataType: string; required: PropertyRequired }) => {
    if (key === "new") {
      setRows((prev) => [...prev, { key: `new:${crypto.randomUUID()}`, ...v }])
    } else {
      setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...v } : r)))
    }
    setEditingKey(null)
  }

  const requestDelete = (r: DraftRow) => {
    // 追加したばかりの行は、保留から外すだけでよい
    if (!r.original) {
      setRows((prev) => prev.filter((x) => x.key !== r.key))
      return
    }
    setDeletingKey(r.key)
  }

  const deletingRow = rows.find((r) => r.key === deletingKey) ?? null

  return (
    <div className="space-y-2">
      {loading && rows.length === 0 ? (
        <div className="flex h-16 items-center justify-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-3 text-center text-xs text-muted-foreground">
          なし
        </p>
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="font-semibold text-foreground">キー名</TableHead>
                <TableHead className="w-24 font-semibold text-foreground">データ型</TableHead>
                <TableHead className="w-20 font-semibold text-foreground">必須/任意</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const status = rowStatus(r)
                const badge = status !== "same" ? STATUS_BADGE[status] : null
                return (
                  <TableRow key={r.key} className={cn(status === "deleted" && "opacity-60")}>
                    <TableCell className="font-medium text-foreground">
                      <div className="flex items-center gap-1.5">
                        <span className={cn(status === "deleted" && "line-through")}>{r.name}</span>
                        {r.original?.description && (
                          <Tooltip content={r.original.description}>
                            <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground/50" />
                          </Tooltip>
                        )}
                        {badge && (
                          <span className={cn("rounded-full border px-1.5 text-[10px]", badge.className)}>
                            {badge.label}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.dataType}</TableCell>
                    <TableCell>
                      <Badge variant={r.required === "必須" ? "default" : "secondary"} className="font-normal">
                        {r.required}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-0.5">
                        {status === "deleted" ? (
                          <Button variant="ghost" size="sm" className="h-7 text-xs"
                            onClick={() => setRows((prev) => prev.map((x) =>
                              x.key === r.key ? { ...x, deleted: undefined } : x))}>
                            元に戻す
                          </Button>
                        ) : (
                          <>
                            <Button variant="ghost" size="icon" className="h-7 w-7"
                              aria-label={`${r.name}を編集`} onClick={() => setEditingKey(r.key)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              aria-label={`${r.name}を削除`} onClick={() => requestDelete(r)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {editingKey ? (
        <PropertyRowEditor
          key={editingKey}
          initial={editingKey === "new" ? undefined : rows.find((r) => r.key === editingKey)}
          onApply={(v) => applyEdit(editingKey, v)}
          onCancel={() => setEditingKey(null)}
        />
      ) : (
        <Button size="sm" variant="outline" className="gap-1 bg-transparent"
          onClick={() => setEditingKey("new")}>
          <Plus className="h-3.5 w-3.5" />プロパティを追加
        </Button>
      )}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}

      <PropertyDeleteChoiceDialog
        open={!!deletingRow}
        onOpenChange={(v) => { if (!v) setDeletingKey(null) }}
        name={deletingRow?.name ?? ""}
        valueCount={deletingRow?.original ? (valueCounts[deletingRow.original.name] ?? 0) : 0}
        onChoose={(removeValues) =>
          setRows((prev) => prev.map((x) => (x.key === deletingKey ? { ...x, deleted: { removeValues } } : x)))
        }
      />
    </div>
  )
})
