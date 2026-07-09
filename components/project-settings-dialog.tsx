"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
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
import { Loader2 } from "lucide-react"
import { validateAllowedDomainsInput } from "@/lib/domain"
import type { Project } from "@/lib/types"

export function ProjectSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { currentProject, setCurrentProject, clearCurrentProject, refreshProjects } = useProject()
  const router = useRouter()

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [domains, setDomains] = useState("")
  const [ownEmail, setOwnEmail] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState("")
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!open || !currentProject) return
    setName(currentProject.name)
    setDescription(currentProject.description ?? "")
    setDomains((currentProject.allowedDomains ?? []).join(","))
    setError("")
    setDeleteConfirmText("")
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data: { email: string }) => setOwnEmail(data.email || ""))
      .catch(() => setOwnEmail(""))
  }, [open, currentProject])

  if (!currentProject) return null

  const handleSave = async () => {
    if (!name.trim()) return
    setError("")

    if (domains.trim()) {
      const validated = validateAllowedDomainsInput(domains, ownEmail)
      if ("error" in validated) {
        setError(validated.error)
        return
      }
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/projects/${currentProject.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim(), allowedDomains: domains.trim() }),
      })
      if (!res.ok) {
        const { error: message } = await res.json().catch(() => ({ error: "更新に失敗しました" }))
        setError(message ?? "更新に失敗しました")
        return
      }
      const updated: Project = await res.json()
      setCurrentProject(updated)
      await refreshProjects()
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  const canDelete = deleteConfirmText === currentProject.name

  const handleDelete = async () => {
    if (!canDelete) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/projects/${currentProject.id}`, { method: "DELETE" })
      if (!res.ok) {
        const { error: message } = await res.json().catch(() => ({ error: "削除に失敗しました" }))
        setError(message ?? "削除に失敗しました")
        setDeleting(false)
        return
      }
      onOpenChange(false)
      clearCurrentProject()
      await refreshProjects()
      router.refresh()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>プロジェクト設定</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="ps-name">プロジェクト名</Label>
            <Input id="ps-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ps-desc">説明</Label>
            <Textarea id="ps-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ps-domains">閲覧可能ドメイン（任意・カンマ区切り）</Label>
            <Input
              id="ps-domains"
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
              placeholder="例：7659sw.com,sample.co.jp（空欄なら誰でも閲覧可）"
            />
            <p className="text-xs text-muted-foreground">
              指定すると、そのドメインのメールアドレスでログインした人だけが閲覧できます。自分自身のドメインは必ず含めてください。
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <div>
              <p className="font-medium text-foreground">作成日</p>
              <p>{new Date(currentProject.createdAt).toLocaleString("ja-JP")}</p>
            </div>
            <div>
              <p className="font-medium text-foreground">作成者</p>
              <p className="truncate">{currentProject.createdBy || "不明（既存プロジェクト）"}</p>
            </div>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30">
            <p className="text-sm font-medium text-red-700 dark:text-red-400">プロジェクトの削除</p>
            <p className="mt-1 text-sm text-red-700/80 dark:text-red-400/80">
              この操作は取り消せません。削除するには、プロジェクト名「{currentProject.name}」を入力してください。
            </p>
            <Input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={currentProject.name}
              className="mt-2 border-red-300 bg-white focus-visible:ring-red-400 dark:border-red-800 dark:bg-transparent"
            />
            <Button
              variant="destructive"
              className="mt-2"
              onClick={handleDelete}
              disabled={!canDelete || deleting}
            >
              {deleting ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" />削除中...</> : "削除する"}
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            閉じる
          </Button>
          <Button onClick={handleSave} disabled={!name.trim() || saving}>
            {saving ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
