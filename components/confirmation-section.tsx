"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { SectionHeader } from "@/components/section-header"
import { ConfirmationBadge } from "@/components/confirmation-badge"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { deriveConfirmationStatus } from "@/lib/confirmation"
import type { ConfirmationEvent } from "@/lib/types"
import { CheckCircle2, ChevronDown, ChevronRight, Loader2, X } from "lucide-react"

const FIELD_LABEL: Record<string, string> = {
  name: "クラス名",
  nameEn: "英語名",
  description: "説明",
  parentId: "親クラス",
  classPairs: "始点/終点クラス",
  parentRelationId: "上位リレーション",
  attributes: "属性",
}

function formatDateTime(iso: string | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
}

export function ConfirmationSection({
  events,
  targetLabel,
  onConfirm,
  onUnconfirm,
}: {
  events: ConfirmationEvent[] | undefined
  // 「クラス」「リレーション」など、ダイアログ文言に差し込む対象種別名
  targetLabel: string
  onConfirm: (confirmerName: string) => Promise<void>
  onUnconfirm: () => Promise<void>
}) {
  const status = deriveConfirmationStatus(events)
  const [showConfirm, setShowConfirm] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [unconfirming, setUnconfirming] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  const sortedEvents = [...(events ?? [])].sort((a, b) => b.at.localeCompare(a.at))

  const handleSubmit = async (confirmerName: string) => {
    setConfirming(true)
    try {
      await onConfirm(confirmerName)
      setShowConfirm(false)
    } finally {
      setConfirming(false)
    }
  }

  const handleUnconfirm = async () => {
    setUnconfirming(true)
    try {
      await onUnconfirm()
    } finally {
      setUnconfirming(false)
    }
  }

  return (
    <section className="space-y-3">
      <SectionHeader icon={CheckCircle2} title="確認" />
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <ConfirmationBadge state={status.state} />
          {status.latestConfirm && (
            <span className="text-xs text-muted-foreground">
              {status.latestConfirm.confirmerName || "—"} / {formatDateTime(status.latestConfirm.at)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="success" className="gap-1.5" onClick={() => setShowConfirm(true)}>
            <CheckCircle2 className="h-3.5 w-3.5" />確認する
          </Button>
          {status.state !== "unconfirmed" && (
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 text-muted-foreground hover:text-destructive"
              onClick={handleUnconfirm}
              disabled={unconfirming}
            >
              {unconfirming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
              確認を取り消す
            </Button>
          )}
        </div>

        <div>
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setHistoryOpen((v) => !v)}
          >
            {historyOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            履歴（{sortedEvents.length}件）
          </button>
          {historyOpen && (
            <div className="mt-2 space-y-1.5 rounded-lg border border-border p-2">
              {sortedEvents.length === 0 ? (
                <p className="text-xs text-muted-foreground">まだ履歴はありません</p>
              ) : (
                sortedEvents.map((e, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span className="mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                      {e.type === "confirm" ? "確認" : e.type === "unconfirm" ? "取消" : "編集"}
                    </span>
                    <div className="flex-1 space-y-0.5">
                      <p className="text-muted-foreground">
                        {formatDateTime(e.at)}
                        {e.actor && <span className="ml-1">（{e.actor}）</span>}
                      </p>
                      {e.type === "confirm" && e.confirmerName && (
                        <p className="text-foreground">確認者：{e.confirmerName}</p>
                      )}
                      {e.type === "edit" && e.editedFields && e.editedFields.length > 0 && (
                        <p className="text-foreground">
                          変更フィールド：{e.editedFields.map((f) => FIELD_LABEL[f] ?? f).join("、")}
                        </p>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={showConfirm}
        onOpenChange={setShowConfirm}
        title={`${targetLabel}を確認する`}
        description="このオントロジー要素の内容が正しいことを確認した専門家の氏名を記入してください。"
        submitting={confirming}
        onSubmit={handleSubmit}
      />
    </section>
  )
}
