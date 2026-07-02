"use client"

import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { AlertTriangle, CheckCircle2, Loader2, Upload } from "lucide-react"
import type { ImportMode, ImportPreview, ParseResult } from "@/lib/import-export"

type ExecuteSummary = {
  created: number
  updated: number
  deleted: number
  note?: string
}

export function ImportDialog<T>({
  open,
  onOpenChange,
  title,
  entityLabel,
  replaceNote,
  parse,
  preview,
  onExecute,
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  entityLabel: string
  replaceNote?: string
  parse: (text: string) => ParseResult<T>
  preview: (items: T[], mode: ImportMode) => ImportPreview | Promise<ImportPreview>
  onExecute: (items: T[], mode: ImportMode) => Promise<ExecuteSummary>
  onImported: () => void | Promise<void>
}) {
  const [mode, setMode] = useState<ImportMode>("diff")
  const [fileName, setFileName] = useState("")
  const [items, setItems] = useState<T[] | null>(null)
  const [fileErrors, setFileErrors] = useState<string[]>([])
  const [previewResult, setPreviewResult] = useState<ImportPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [summary, setSummary] = useState<ExecuteSummary | null>(null)
  const previewRequestId = useRef(0)

  const reset = () => {
    setFileName(""); setItems(null); setFileErrors([]); setPreviewResult(null)
    setSummary(null); setMode("diff"); setPreviewLoading(false)
  }

  const close = () => { reset(); onOpenChange(false) }

  const runPreview = async (list: T[], m: ImportMode) => {
    const requestId = ++previewRequestId.current
    setPreviewLoading(true)
    try {
      const result = await preview(list, m)
      if (requestId === previewRequestId.current) setPreviewResult(result)
    } finally {
      if (requestId === previewRequestId.current) setPreviewLoading(false)
    }
  }

  const handleFile = async (file: File) => {
    setFileName(file.name)
    setSummary(null)
    const text = await file.text()
    const result = parse(text)
    if (!result.ok) {
      setItems(null); setFileErrors(result.errors); setPreviewResult(null)
      return
    }
    setFileErrors([])
    setItems(result.items)
    await runPreview(result.items, mode)
  }

  const handleModeChange = (next: ImportMode) => {
    setMode(next)
    if (items) runPreview(items, next)
  }

  const handleExecute = async () => {
    if (!items || !previewResult || previewResult.errors.length > 0) return
    setExecuting(true)
    try {
      const result = await onExecute(items, mode)
      setSummary(result)
      await onImported()
    } finally {
      setExecuting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); else onOpenChange(v) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>

        {summary ? (
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <div className="text-sm text-foreground">
                <p>インポートが完了しました。</p>
                <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                  <li>追加: {summary.created}件</li>
                  <li>更新: {summary.updated}件</li>
                  {mode === "replace" && <li>削除: {summary.deleted}件</li>}
                  {summary.note && <li>{summary.note}</li>}
                </ul>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground hover:bg-muted">
                <Upload className="h-5 w-5" />
                <span>{fileName || "YAMLファイルを選択"}</span>
                <input
                  type="file"
                  accept=".yaml,.yml,text/yaml"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
                />
              </label>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">取り込みモード</p>
              <div className="flex flex-col gap-1.5">
                <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
                  <input type="radio" name="import-mode" className="mt-0.5 accent-foreground"
                    checked={mode === "diff"} onChange={() => handleModeChange("diff")} />
                  <span>
                    差分（追加分のみ）
                    <span className="block text-xs font-normal text-muted-foreground">
                      ファイルにあり既存にない{entityLabel}・属性のみ追加します。既存の内容は変更・削除しません。
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
                  <input type="radio" name="import-mode" className="mt-0.5 accent-foreground"
                    checked={mode === "replace"} onChange={() => handleModeChange("replace")} />
                  <span>
  全差替え
                    <span className="block text-xs font-normal text-muted-foreground">
                      ファイルの内容に完全に一致させます。ファイルにない既存の{entityLabel}は削除されます。
                      {replaceNote && ` ${replaceNote}`}
                    </span>
                  </span>
                </label>
              </div>
            </div>

            {previewLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />プレビューを計算中…
              </div>
            )}

            {fileErrors.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <ul className="list-inside list-disc text-xs text-destructive">
                  {fileErrors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            )}

            {previewResult && previewResult.errors.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <ul className="list-inside list-disc text-xs text-destructive">
                  {previewResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            )}

            {previewResult && previewResult.errors.length === 0 && (
              <div className="rounded-md border border-border px-3 py-2 text-sm text-foreground">
                <p className="font-medium">プレビュー</p>
                <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                  <li>追加: {previewResult.toCreate.length}件{previewResult.toCreate.length > 0 && `（${previewResult.toCreate.join("、")}）`}</li>
                  {mode === "replace" && (
                    <>
                      <li>更新: {previewResult.toUpdate.length}件</li>
                      <li>削除: {previewResult.toDelete.length}件{previewResult.toDelete.length > 0 && `（${previewResult.toDelete.join("、")}）`}</li>
                    </>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {summary ? (
            <Button onClick={close}>閉じる</Button>
          ) : (
            <>
              <Button variant="outline" onClick={close} disabled={executing}>キャンセル</Button>
              <Button
                onClick={handleExecute}
                disabled={!items || !previewResult || previewResult.errors.length > 0 || previewLoading || executing}
              >
                {executing ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" />実行中…</> : "インポートを実行"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
