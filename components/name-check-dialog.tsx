"use client"

import { useState, useEffect, useCallback } from "react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { OntologyInstance } from "@/lib/types"
import { instanceStatus, normalizedNameOf } from "@/lib/instance-status"
import { Loader2, CheckCheck, Check } from "lucide-react"
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  DragOverlay,
  pointerWithin,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"

// 1つの「本登録候補」＝代表インスタンス1つ＋統合される配下（別名）インスタンス群
type Grp = { canonical: OntologyInstance; children: OntologyInstance[] }

// --- ドラッグ可能なインスタンスチップ ---
// showCheck: 本登録される（＝代表）ことを示すチェックマーク。配下（別名）には付かない。
function InstanceChip({
  inst,
  muted,
  disabled,
  showCheck,
}: {
  inst: OntologyInstance
  muted?: boolean
  disabled?: boolean
  showCheck?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: inst.id,
    disabled,
  })
  return (
    <div
      ref={setNodeRef}
      {...(disabled ? {} : listeners)}
      {...attributes}
      style={{ transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined }}
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors select-none",
        disabled ? "cursor-default" : "cursor-grab active:cursor-grabbing hover:border-ring",
        muted
          ? "border-border/40 bg-muted/40 text-muted-foreground"
          : "border-border bg-card font-medium text-foreground",
        isDragging && "opacity-40",
      )}
    >
      <span className="flex-1 truncate">{inst.name}</span>
      {showCheck && <Check className="h-4 w-4 shrink-0 text-green-600 dark:text-green-500" />}
    </div>
  )
}

// --- グループ（ドロップ先） ---
function GroupCard({ group }: { group: Grp }) {
  const { setNodeRef, isOver } = useDroppable({ id: `grp:${group.canonical.id}` })
  const hasChildren = group.children.length > 0

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-2xl transition-colors",
        hasChildren ? "border border-border bg-muted/20 p-3" : "",
        isOver ? "ring-2 ring-ring ring-offset-2" : "",
      )}
    >
      {/* 代表（本登録される＝チェックマーク付き） */}
      <InstanceChip inst={group.canonical} disabled={hasChildren} showCheck />
      {/* 配下（別名） */}
      {hasChildren && (
        <div className="mt-2 space-y-1.5">
          {group.children.map((c) => (
            <InstanceChip key={c.id} inst={c} muted />
          ))}
        </div>
      )}
    </div>
  )
}

export function NameCheckDialog({
  open,
  onOpenChange,
  projectId,
  classId,
  onResolved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string | null
  // 指定時はそのクラス（または "unclassified"）の仮登録だけを対象にする
  classId?: string | null
  onResolved: () => void
}) {
  const [groups, setGroups] = useState<Grp[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const load = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    try {
      // classId 指定時はそのクラス（未分類含む）だけ、未指定時はプロジェクト全体
      const url = classId
        ? `/api/instances?classId=${encodeURIComponent(classId)}`
        : `/api/instances?projectId=${projectId}`
      const all: OntologyInstance[] = await fetch(url).then((r) => r.json())
      const provisional = (Array.isArray(all) ? all : []).filter((i) => instanceStatus(i) === "provisional")
      // 正規化キーで下ごしらえ（同一表記は最初から入れ子で提示）
      const buckets = new Map<string, OntologyInstance[]>()
      for (const inst of provisional) {
        const key = normalizedNameOf(inst)
        const arr = buckets.get(key)
        if (arr) arr.push(inst)
        else buckets.set(key, [inst])
      }
      const initial: Grp[] = []
      for (const members of buckets.values()) {
        // 代表の初期値＝最も長い表記（より完全な形とみなす）
        const canonical = members.reduce((a, b) => (b.name.length > a.name.length ? b : a))
        const children = members.filter((m) => m.id !== canonical.id)
        initial.push({ canonical, children })
      }
      // 名前順で安定表示
      initial.sort((a, b) => a.canonical.name.localeCompare(b.canonical.name, "ja"))
      setGroups(initial)
    } catch {
      setError("未チェックインスタンスの取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [projectId, classId])

  useEffect(() => {
    if (open) load()
    else setGroups([])
  }, [open, load])

  // すべてのインスタンス（id→inst）を平坦化して引けるように
  const findInstance = (id: string): OntologyInstance | null => {
    for (const g of groups) {
      if (g.canonical.id === id) return g.canonical
      const c = g.children.find((x) => x.id === id)
      if (c) return c
    }
    return null
  }

  const groupOf = (id: string): Grp | undefined =>
    groups.find((g) => g.canonical.id === id || g.children.some((c) => c.id === id))

  // source を target グループの配下に移す
  const moveToGroup = (sourceId: string, targetCanonicalId: string) => {
    if (sourceId === targetCanonicalId) return
    const source = findInstance(sourceId)
    if (!source) return
    const targetGrp = groups.find((g) => g.canonical.id === targetCanonicalId)
    if (!targetGrp) return
    // すでに同じグループなら何もしない
    if (targetGrp.children.some((c) => c.id === sourceId)) return

    setGroups((prev) => {
      // source を現在地から取り除く（standalone グループごと、または子として）
      const next: Grp[] = []
      let carriedChildren: OntologyInstance[] = []
      for (const g of prev) {
        if (g.canonical.id === sourceId) {
          // source が standalone/代表だった場合、その配下も一緒に移す
          carriedChildren = g.children
          continue // このグループは消える
        }
        const filteredChildren = g.children.filter((c) => c.id !== sourceId)
        next.push({ ...g, children: filteredChildren })
      }
      // target に source（＋運んできた配下）を追加
      return next.map((g) =>
        g.canonical.id === targetCanonicalId
          ? { ...g, children: [...g.children, source, ...carriedChildren] }
          : g,
      )
    })
  }

  // source をグループから外して単独（standalone）に戻す
  const makeStandalone = (sourceId: string) => {
    const grp = groupOf(sourceId)
    if (!grp || grp.canonical.id === sourceId) return // すでに代表（単独 or グループ長）なら対象外
    const source = findInstance(sourceId)
    if (!source) return
    setGroups((prev) => {
      const next = prev.map((g) => ({ ...g, children: g.children.filter((c) => c.id !== sourceId) }))
      next.push({ canonical: source, children: [] })
      next.sort((a, b) => a.canonical.name.localeCompare(b.canonical.name, "ja"))
      return next
    })
  }

  const handleDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id))
  const handleDragEnd = (e: DragEndEvent) => {
    setActiveId(null)
    const sourceId = String(e.active.id)
    if (!e.over) {
      // どのグループにも重ねていない → 入れ子解除
      makeStandalone(sourceId)
      return
    }
    const overId = String(e.over.id)
    if (overId.startsWith("grp:")) {
      moveToGroup(sourceId, overId.slice(4))
    }
  }

  const totalCount = groups.reduce((n, g) => n + 1 + g.children.length, 0)
  const mergeCount = groups.reduce((n, g) => n + g.children.length, 0)

  const handleRegister = async () => {
    if (!projectId) return
    setBusy(true)
    setError(null)
    try {
      const standaloneIds: string[] = []
      for (const g of groups) {
        if (g.children.length === 0) {
          standaloneIds.push(g.canonical.id)
        } else {
          // 配下を代表へ統合（merge が代表を本登録にもする）
          for (const child of g.children) {
            const res = await fetch("/api/instances/resolve", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                projectId,
                action: "merge",
                loserId: child.id,
                canonicalId: g.canonical.id,
                method: "manual",
              }),
            })
            if (!res.ok) throw new Error()
          }
        }
      }
      // 単独インスタンスをまとめて本登録
      if (standaloneIds.length > 0) {
        const res = await fetch("/api/instances/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, action: "confirm", instanceIds: standaloneIds }),
        })
        if (!res.ok) throw new Error()
      }
      onResolved()
      onOpenChange(false)
    } catch {
      setError("名寄せの確定に失敗しました")
    } finally {
      setBusy(false)
    }
  }

  const activeInst = activeId ? findInstance(activeId) : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>名寄せチェック</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          同義と思われるインスタンスは統合したうえで名寄せを確定できます（インスタンスをドラッグ＆ドロップしてください）。統合はこの画面での操作によってのみ確定します（自動では行いません）。
        </p>

        <div className="flex-1 overflow-y-auto py-2">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : error ? (
            <p className="py-8 text-center text-sm text-destructive">{error}</p>
          ) : groups.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
              <CheckCheck className="h-8 w-8 text-green-500" />
              名寄せチェックが必要なインスタンスはありません。
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={pointerWithin}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <div className="flex flex-wrap items-start gap-3">
                {groups.map((g) => (
                  <div key={g.canonical.id} className="w-56">
                    <GroupCard group={g} />
                  </div>
                ))}
              </div>
              <DragOverlay>
                {activeInst ? (
                  <div className="rounded-md border border-ring bg-card px-3 py-1.5 text-center text-sm font-medium text-foreground shadow-lg">
                    {activeInst.name}
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          )}
        </div>

        {groups.length > 0 && (
          <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xs text-muted-foreground">
              {totalCount} 件の未チェック{mergeCount > 0 ? `／うち ${mergeCount} 件を統合` : ""}
            </span>
            <Button variant="success" onClick={handleRegister} disabled={busy}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              この内容で名寄せを確定する
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
