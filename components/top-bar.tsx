import { Button } from "@/components/ui/button"

export function TopBar({
  title,
  action,
}: {
  title: string
  action?: { label: string; icon?: React.ElementType }
}) {
  const Icon = action?.icon
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-6">
      <h1 className="text-base font-semibold text-foreground">{title}</h1>
      {action && (
        <Button size="sm" className="gap-2">
          {Icon && <Icon className="h-4 w-4" />}
          {action.label}
        </Button>
      )}
    </header>
  )
}
