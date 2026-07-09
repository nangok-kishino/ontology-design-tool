"use client"

import { useEffect, useState } from "react"
import { useProject } from "@/app/project-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FolderOpen, Plus, Boxes, Lock } from "lucide-react"
import { validateAllowedDomainsInput } from "@/lib/domain"
import type { Project } from "@/lib/types"

export function ProjectWelcomeScreen() {
  const { projects, setCurrentProject, refreshProjects } = useProject()
  const [showDialog, setShowDialog] = useState(false)
  const [newName, setNewName] = useState("")
  const [newDesc, setNewDesc] = useState("")
  const [newDomains, setNewDomains] = useState("")
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState("")
  const [ownEmail, setOwnEmail] = useState("")

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data: { email: string }) => setOwnEmail(data.email || ""))
      .catch(() => setOwnEmail(""))
  }, [])

  const handleCreate = async () => {
    if (!newName.trim()) return
    setError("")

    if (newDomains.trim()) {
      const validated = validateAllowedDomainsInput(newDomains, ownEmail)
      if ("error" in validated) {
        setError(validated.error)
        return
      }
    }

    setCreating(true)
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim(), allowedDomains: newDomains.trim() }),
      })
      if (!res.ok) {
        const { error: message } = await res.json().catch(() => ({ error: "プロジェクトの作成に失敗しました" }))
        setError(message ?? "プロジェクトの作成に失敗しました")
        return
      }
      const created: Project = await res.json()
      await refreshProjects()
      setCurrentProject(created)
      setShowDialog(false)
      setNewName("")
      setNewDesc("")
      setNewDomains("")
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 p-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/20">
          <Boxes className="h-6 w-6 text-indigo-400" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">プロジェクトを選択</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {projects.length > 0
              ? "作業するプロジェクトを選択するか、新規作成してください"
              : "まず最初にプロジェクトを作成してください"}
          </p>
        </div>
      </div>

      {projects.length > 0 && (
        <div className="w-full max-w-md space-y-2">
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => setCurrentProject(p)}
              className="flex w-full items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-muted"
            >
              <FolderOpen className="h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate font-medium text-foreground">{p.name}</p>
                  {p.allowedDomains && p.allowedDomains.length > 0 && (
                    <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="限定公開プロジェクト" />
                  )}
                </div>
                {p.description && (
                  <p className="truncate text-xs text-muted-foreground">{p.description}</p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      <Button onClick={() => setShowDialog(true)}>
        <Plus className="mr-1.5 h-4 w-4" />
        新しいプロジェクトを作成
      </Button>

      <Dialog
        open={showDialog}
        onOpenChange={(open) => {
          setShowDialog(open)
          if (!open) setError("")
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新しいプロジェクト</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="wc-name">プロジェクト名</Label>
              <Input
                id="wc-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="例：製造知識継承オントロジー"
                onKeyDown={(e) => e.key === "Enter" && !creating && handleCreate()}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wc-desc">説明（任意）</Label>
              <Textarea
                id="wc-desc"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                rows={3}
                placeholder="プロジェクトの目的・概要"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wc-domains">閲覧可能ドメイン（任意・カンマ区切り）</Label>
              <Input
                id="wc-domains"
                value={newDomains}
                onChange={(e) => setNewDomains(e.target.value)}
                placeholder="例：7659sw.com,sample.co.jp（空欄なら誰でも閲覧可）"
              />
              <p className="text-xs text-muted-foreground">
                指定すると、そのドメインのメールアドレスでログインした人だけが閲覧できます。自分自身のドメインは必ず含めてください。
              </p>
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              キャンセル
            </Button>
            <Button onClick={handleCreate} disabled={!newName.trim() || creating}>
              {creating ? "作成中..." : "作成"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
