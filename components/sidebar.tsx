"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  LayoutDashboard, Boxes, GitBranch, FileInput, Database, FolderOpen, BookOpen, LogOut,
} from "lucide-react"
import { useProject } from "@/app/project-context"

export type ScreenId = "dashboard" | "review" | "classes" | "relations" | "instances" | "ontology-info"

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
    items: [{ id: "instances", label: "登録済みインスタンス", icon: Database }],
  },
]

export function Sidebar({
  active,
  onNavigate,
}: {
  active: ScreenId
  onNavigate: (id: ScreenId) => void
}) {
  const { currentProject, clearCurrentProject } = useProject()
  const router = useRouter()
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data: { email: string }) => setEmail(data.email || null))
      .catch(() => setEmail(null))
  }, [])

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" })
    router.push("/login")
    router.refresh()
  }

  return (
    <aside className="flex h-screen w-60 flex-col border-r border-white/[0.06] bg-zinc-950 text-neutral-100">
      {/* アプリタイトル */}
      <div className="flex items-center gap-2.5 px-4 py-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500">
          <Boxes className="h-4 w-4 text-white" />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-tight text-white">オントロジー設計</p>
          <p className="text-[11px] text-zinc-400">オントロジー設計支援ツール</p>
        </div>
      </div>

      {/* プロジェクト表示 */}
      <div className="px-3 pb-3">
        <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
          プロジェクト
        </p>
        {currentProject ? (
          <div className="flex items-center justify-between rounded-md px-2 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-zinc-300" />
              <span className="truncate text-sm font-medium text-zinc-100">{currentProject.name}</span>
            </div>
            <button
              onClick={clearCurrentProject}
              className="ml-2 shrink-0 text-[11px] text-zinc-400 transition-colors hover:text-zinc-100"
            >
              変更
            </button>
          </div>
        ) : (
          <button
            onClick={() => onNavigate("dashboard")}
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-white/5"
          >
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            <span className="text-sm text-zinc-500">未選択</span>
          </button>
        )}
      </div>

      {/* ナビゲーション（プロジェクト選択時のみ） */}
      {currentProject && (
        <>
          <div className="mx-3 border-t border-white/[0.06]" />
          <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
            {navGroups.map((group) => (
              <div key={group.label} className="space-y-0.5">
                <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
                  {group.label}
                </p>
                {group.items.map((item) => {
                  const Icon = item.icon
                  const isActive = active === item.id
                  return (
                    <button
                      key={item.id}
                      onClick={() => onNavigate(item.id)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                        isActive
                          ? "bg-white/10 font-medium text-white"
                          : "text-zinc-300 hover:bg-white/5 hover:text-white",
                      )}
                    >
                      <Icon
                        className={cn(
                          "h-4 w-4 shrink-0",
                          isActive ? "text-indigo-400" : "text-zinc-400",
                        )}
                      />
                      <span>{item.label}</span>
                    </button>
                  )
                })}
              </div>
            ))}
          </nav>
        </>
      )}

      {/* オントロジーについて（常時表示・下部固定） */}
      <div className={cn("mx-3 border-t border-white/[0.06]", !currentProject && "mt-auto")} />
      <div className="px-3 py-3">
        <button
          onClick={() => onNavigate("ontology-info")}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
            active === "ontology-info"
              ? "bg-white/10 font-medium text-white"
              : "text-zinc-300 hover:bg-white/5 hover:text-white",
          )}
        >
          <BookOpen
            className={cn(
              "h-4 w-4 shrink-0",
              active === "ontology-info" ? "text-indigo-400" : "text-zinc-400",
            )}
          />
          <span>オントロジーについて</span>
        </button>
      </div>

      {/* ログイン情報・ログアウト（常時表示・最下部） */}
      <div className="mx-3 border-t border-white/[0.06]" />
      <div className="px-3 py-3">
        {email && (
          <p className="truncate px-2.5 pb-1.5 text-[11px] text-zinc-500" title={email}>
            {email}
          </p>
        )}
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-zinc-300 transition-colors hover:bg-white/5 hover:text-white"
        >
          <LogOut className="h-4 w-4 shrink-0 text-zinc-400" />
          <span>ログアウト</span>
        </button>
      </div>
    </aside>
  )
}
