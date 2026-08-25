"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Loader2 } from "lucide-react"

// 確認者名を入力して[確認]レコードを追加するダイアログ。
// 単体確認・一括確認で共通利用できる。
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  submitting,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  description?: string
  submitting: boolean
  onSubmit: (confirmerName: string) => Promise<void> | void
}) {
  const [name, setName] = useState("")

  useEffect(() => {
    if (open) setName("")
  }, [open])

  const canSubmit = name.trim().length > 0 && !submitting

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!submitting) onOpenChange(v) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">確認者 <span className="text-destructive">*</span></Label>
            <Textarea
              rows={2}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：山田太郎 / 田中一郎（品証）"
            />
            <p className="text-xs text-muted-foreground">複数人の場合は自由に併記してください</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            キャンセル
          </Button>
          <Button variant="success" onClick={() => onSubmit(name.trim())} disabled={!canSubmit}>
            {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}確認する
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
