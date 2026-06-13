"use client"

import { cn } from "@/lib/utils"
import { LayoutDashboard, Boxes, GitBranch, FileInput, Database } from "lucide-react"

export type ScreenId = "dashboard" | "review" | "classes" | "relations" | "instances"

type NavItem = { id: ScreenId; label: string; icon: React.ElementType }
type NavGroup = { label: string; items: NavItem[] }

const navGroups: NavGroup[] = [
  {
    label: "全体",
    items: [
      { id: "dashboard", label: "ダッシュボード", icon: LayoutDashboard },
      { id: "review", label: "文書取込み", icon: FileInput },
    ],
  },
  {
    label: "オントロジー設計",
    items: [
      { id: "classes", label: "クラス管理", icon: Boxes },
      { id: "relations", label: "リレーション管理", icon: GitBranch },
    ],
  },
  {
    label: "インスタンス管理",
    items: [{ id: "instances", label: "クラス用インスタンス", icon: Database }],
  },
]

export function Sidebar({
  active,
  onNavigate,
}: {
  active: ScreenId
  onNavigate: (id: ScreenId) => void
}) {
  return (
    <aside className="flex h-screen w-60 flex-col border-r border-neutral-800 bg-neutral-900 text-neutral-100">
      <div className="flex items-center gap-2 border-b border-neutral-800 px-5 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-neutral-100 text-neutral-900">
          <Boxes className="h-5 w-5" />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold">オントロジー</p>
          <p className="text-xs text-neutral-400">設計支援ツール</p>
        </div>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {navGroups.map((group) => (
          <div key={group.label} className="space-y-1">
            <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">{group.label}</p>
            {group.items.map((item) => {
              const Icon = item.icon
              const isActive = active === item.id
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-neutral-100 font-medium text-neutral-900"
                      : "text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-neutral-800 px-5 py-4">
        <p className="text-xs text-neutral-500">プロジェクト</p>
        <p className="mt-0.5 truncate text-sm font-medium text-neutral-200">製造知識継承オントロジー</p>
      </div>
    </aside>
  )
}
