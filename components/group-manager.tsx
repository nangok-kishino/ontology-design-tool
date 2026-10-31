"use client"

// 整理用グループの取得・管理。クラス管理／リレーション管理の双方から使う。
//   グループはオントロジーの意味ではなく「人が把握するための束ね」なので、
//   クラスとリレーションで同じ一覧を共用する（例：「受注まわり」に両方が入る）。

import { useCallback, useEffect, useState } from "react"
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { sortGroups } from "@/lib/organize"
import type { OntologyGroup } from "@/lib/types"

// 見分けやすさ優先の控えめな色。未選択（色なし）も選べる。
export const GROUP_COLORS = [
  "#64748b", // slate
  "#0ea5e9", // sky
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#14b8a6", // teal
] as const

export function useGroups(projectId: string | undefined) {
  const [groups, setGroups] = useState<OntologyGroup[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!projectId) {
      setGroups([])
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/groups?projectId=${projectId}`)
      if (!res.ok) return
      const data = await res.json()
      setGroups(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    setGroups([])
  }, [projectId])

  return { groups, setGroups, loading, refresh }
}

// グループの追加・改名・色変更・並び替え・削除。保存で一覧ごと置き換える。
export function GroupManagerDialog({
  open,
  onOpenChange,
  projectId,
  groups,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  groups: OntologyGroup[]
  onSaved: (groups: OntologyGroup[]) => void
}) {
  const [draft, setDraft] = useState<OntologyGroup[]>([])
  const [newName, setNewName] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 開いた瞬間だけ、そのときのグループで編集内容を初期化する。
  // groups を依存に入れると編集中に親が再取得したとき入力が消えるため、open だけを見る。
  useEffect(() => {
    if (open) {
      setDraft(sortGroups(groups))
      setNewName("")
      setError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const removedCount = groups.filter((g) => !draft.some((d) => d.id === g.id)).length

  const move = (index: number, delta: number) => {
    const to = index + delta
    if (to < 0 || to >= draft.length) return
    const next = [...draft]
    const [item] = next.splice(index, 1)
    next.splice(to, 0, item)
    setDraft(next)
  }

  const addDraft = () => {
    const name = newName.trim()
    if (!name) return
    if (draft.some((g) => g.name === name)) {
      setError(`グループ「${name}」は既に存在します`)
      return
    }
    // 保存時に PUT でまとめて確定するため、ここでは id を発行してローカルに積むだけ
    setDraft([...draft, { id: crypto.randomUUID(), name, order: draft.length, color: GROUP_COLORS[draft.length % GROUP_COLORS.length] }])
    setNewName("")
    setError(null)
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      // 並び替えの結果をそのまま order に落とす（1000刻み）
      const payload = draft.map((g, i) => ({ ...g, order: (i + 1) * 1000 }))
      const res = await fetch("/api/groups", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, groups: payload }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.error ?? "グループの保存に失敗しました")
        return
      }
      onSaved(await res.json())
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>グループの管理</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-xs text-muted-foreground">
            クラスとリレーションを束ねて見るための整理用の区分です。オントロジーの意味には影響せず、
            Neo4jへのエクスポートにも含まれません。
          </p>

          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {draft.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">グループがありません</p>
            )}
            {draft.map((g, i) => (
              <div key={g.id} className="flex items-center gap-2">
                <div className="flex shrink-0 gap-0.5">
                  {GROUP_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`色 ${c}`}
                      onClick={() => setDraft(draft.map((d) => (d.id === g.id ? { ...d, color: c } : d)))}
                      className={cn(
                        "h-4 w-4 rounded-full border-2",
                        g.color === c ? "border-foreground" : "border-transparent",
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <Input
                  value={g.name}
                  onChange={(e) => setDraft(draft.map((d) => (d.id === g.id ? { ...d, name: e.target.value } : d)))}
                  className="h-8 flex-1"
                />
                <Button size="icon" variant="ghost" className="h-8 w-8" disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" disabled={i === draft.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setDraft(draft.filter((d) => d.id !== g.id))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 border-t pt-3">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="新しいグループ名"
              className="h-8 flex-1"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDraft() } }}
            />
            <Button size="sm" variant="outline" className="gap-1.5" onClick={addDraft} disabled={!newName.trim()}>
              <Plus className="h-3.5 w-3.5" />追加
            </Button>
          </div>

          {removedCount > 0 && (
            <p className="text-xs text-amber-600">
              保存すると {removedCount} 件のグループが削除され、所属していたクラス・リレーションは「未分類」に戻ります。
            </p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>キャンセル</Button>
          <Button variant="success" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
