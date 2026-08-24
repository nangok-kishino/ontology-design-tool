import { Button } from "@/components/ui/button"
import { ChevronRight } from "lucide-react"

export function TopBar({
  title,
  group,
  action,
  children,
}: {
  title: string
  group?: string
  action?: { label: string; icon?: React.ElementType }
  children?: React.ReactNode
}) {
  const Icon = action?.icon
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-6">
      <nav aria-label="breadcrumb" className="flex items-center gap-1.5 text-base">
        {group && (
          <>
            <span className="font-normal text-muted-foreground">{group}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
          </>
        )}
        <h1 className="font-semibold text-foreground">{title}</h1>
      </nav>
      <div className="flex items-center gap-2">
        {children}
        {action && (
          <Button size="sm" className="gap-2">
            {Icon && <Icon className="h-4 w-4" />}
            {action.label}
          </Button>
        )}
      </div>
    </header>
  )
}
