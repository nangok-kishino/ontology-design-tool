import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { ConfirmationState } from "@/lib/confirmation"
import { CheckCircle2, CircleDashed } from "lucide-react"

export function ConfirmationBadge({ state, className }: { state: ConfirmationState; className?: string }) {
  if (state === "confirmed") {
    return (
      <Badge className={cn("border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200", className)}>
        <CheckCircle2 />確認済み
      </Badge>
    )
  }
  if (state === "confirmed_edited") {
    return (
      <Badge className={cn("border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300", className)}>
        <CheckCircle2 />確認済み*
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className={cn("text-muted-foreground", className)}>
      <CircleDashed />未確認
    </Badge>
  )
}
