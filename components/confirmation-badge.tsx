import { Badge } from "@/components/ui/badge"
import { Tooltip } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { formatConfirmDateTime, type ConfirmationState, type ConfirmationStatus } from "@/lib/confirmation"
import { CheckCircle2, CircleDashed } from "lucide-react"

export function ConfirmationBadge({
  state,
  latestConfirm,
  className,
}: {
  state: ConfirmationState
  // 渡された場合、確認済みバッジのホバーで確認日／確認者をツールチップ表示する（履歴は出さない）
  latestConfirm?: ConfirmationStatus["latestConfirm"]
  className?: string
}) {
  const base = "h-6 w-28 text-sm [&>svg]:size-3.5!"
  if (state === "confirmed" || state === "confirmed_edited") {
    const badge =
      state === "confirmed" ? (
        <Badge className={cn(base, "border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200", className)}>
          <CheckCircle2 />確認済み
        </Badge>
      ) : (
        <Badge className={cn(base, "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300", className)}>
          <CheckCircle2 />確認済み*
        </Badge>
      )
    if (!latestConfirm) return badge
    return (
      <Tooltip
        content={
          <div className="space-y-0.5">
            <p className="whitespace-nowrap">確認日　{formatConfirmDateTime(latestConfirm.at)}</p>
            {latestConfirm.confirmerName && <p>確認者　{latestConfirm.confirmerName}</p>}
          </div>
        }
      >
        {badge}
      </Tooltip>
    )
  }
  return (
    <Badge variant="outline" className={cn(base, "text-muted-foreground", className)}>
      <CircleDashed />未確認
    </Badge>
  )
}
