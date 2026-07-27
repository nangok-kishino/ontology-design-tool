import type { LucideIcon } from "lucide-react"

export function SectionHeader({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-zinc-950 px-3 py-2 text-neutral-100">
      <Icon className="h-4 w-4 text-zinc-400" />
      <h3 className="text-sm font-semibold">{title}</h3>
    </div>
  )
}
