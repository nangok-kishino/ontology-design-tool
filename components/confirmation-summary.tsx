"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import type { ConfirmationEvent } from "@/lib/types"
import { deriveConfirmationStatus } from "@/lib/confirmation"

function formatDateTime(iso: string | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
}

// 詳細パネルの基本情報エリア用: 「確認日 xxx（xxx）▽確認履歴」＋履歴の折りたたみを描画する。
// 確認レコードが1件も無い（未確認）場合は何も描画しない（呼び出し側の登録日/更新日だけ残る）。
export function ConfirmationSummary({
  events,
  fieldLabels,
}: {
  events: ConfirmationEvent[] | undefined
  // edit イベントの editedFields キーを日本語に変換するテーブル
  fieldLabels: Record<string, string>
}) {
  const status = deriveConfirmationStatus(events)
  const [open, setOpen] = useState(false)

  if (!status.latestConfirm) return null

  const sortedEvents = [...(events ?? [])].sort((a, b) => b.at.localeCompare(a.at))

  return (
    <>
      <p className="flex items-center gap-2">
        <span>
          確認日 {formatDateTime(status.latestConfirm.at)}
          {status.latestConfirm.confirmerName && `（${status.latestConfirm.confirmerName}）`}
        </span>
        <button
          type="button"
          className="inline-flex items-center gap-0.5 text-muted-foreground/80 hover:text-foreground"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          確認履歴
        </button>
      </p>
      {open && (
        <div className="space-y-1.5 rounded-lg border border-border p-2">
          {sortedEvents.length === 0 ? (
            <p>まだ履歴はありません</p>
          ) : (
            sortedEvents.map((e, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                  {e.type === "confirm" ? "確認" : e.type === "unconfirm" ? "取消" : "編集"}
                </span>
                <div className="flex-1 space-y-0.5">
                  <p>{formatDateTime(e.at)}{e.actor && <span className="ml-1">（{e.actor}）</span>}</p>
                  {e.type === "confirm" && e.confirmerName && (
                    <p className="text-foreground">確認者：{e.confirmerName}</p>
                  )}
                  {e.type === "edit" && e.editedFields && e.editedFields.length > 0 && (
                    <p className="text-foreground">
                      変更フィールド：{e.editedFields.map((f) => fieldLabels[f] ?? f).join("、")}
                    </p>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </>
  )
}
