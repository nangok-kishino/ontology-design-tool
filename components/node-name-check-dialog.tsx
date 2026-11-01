"use client"

// ノード名寄せ（グラフデータ作成）。未チェックのノードを並べ、同じものを束ねて確定する。
//
// 【原則】システムは自動で統合しない。正規化して一致したものは最初から入れ子で
// 提示するが、それは下ごしらえであって確定ではない。確定は必ずこの画面の操作から
// /api/nodes/resolve を通る（docs/graph-model.md §5、名寄せ設計の原則A・B）。
//
// 照合のスコープは「ラベル集合が完全一致 × 正規化した名前」。ラベルが違えば
// 別物として扱う（カテゴリノードの「支柱」と個体の「支柱」が束ねられないように）。
// ただし人が手で重ねる分には、ラベルが違っても統合できる。

import { useCallback, useEffect, useMemo, useState } from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { normalizeName } from "@/lib/normalize"
import { LabelChips } from "@/components/label-chip"
import type { GraphNode, Label } from "@/lib/graph-types"
import { Check, CheckCheck, Loader2 } from "lucide-react"
import {
  DndContext, DragOverlay, PointerSensor, pointerWithin, useDraggable, useDroppable,
  useSensor, useSensors, type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core"

// 1つの束＝代表ノード1つ＋統合される配下（別名）ノード群
type Bundle = { canonical: GraphNode; children: GraphNode[] }

function NodeChip({
  node,
  labelNames,
  muted,
  disabled,
  showCheck,
}: {
  node: GraphNode
  labelNames: string[]
  muted?: boolean
  disabled?: boolean
  // 代表（＝チェック済みになる側）であることを示す
  showCheck?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: node.id, disabled,
  })
  return (
    <div
      ref={setNodeRef}
      {...(disabled ? {} : listeners)}
      {...attributes}
      style={{ transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined }}
      className={cn(
        "flex select-none items-start gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
        disabled ? "cursor-default" : "cursor-grab hover:border-ring active:cursor-grabbing",
        muted
          ? "border-border/40 bg-muted/40 text-muted-foreground"
          : "border-border bg-card font-medium text-foreground",
        isDragging && "opacity-40",
      )}
    >
      <span className="min-w-0 flex-1 space-y-1">
        <LabelChips names={labelNames} />
        <span className="block truncate" title={node.name}>{node.name}</span>
      </span>
      {showCheck && <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-500" />}
    </div>
  )
}

function BundleCard({ bundle, labelNames }: { bundle: Bundle; labelNames: (n: GraphNode) => string[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: `grp:${bundle.canonical.id}` })
  const hasChildren = bundle.children.length > 0
  return (
    <div ref={setNodeRef}
      className={cn(
        "rounded-2xl transition-colors",
        hasChildren ? "border border-border bg-muted/20 p-3" : "",
        isOver ? "ring-2 ring-ring ring-offset-2" : "",
      )}>
      <NodeChip node={bundle.canonical} labelNames={labelNames(bundle.canonical)}
        disabled={hasChildren} showCheck />
      {hasChildren && (
        <div className="mt-2 space-y-1.5">
          {bundle.children.map((c) => (
            <NodeChip key={c.id} node={c} labelNames={labelNames(c)} muted />
          ))}
        </div>
      )}
    </div>
  )
}

export function NodeNameCheckDialog({
  open,
  onOpenChange,
  projectId,
  labels,
  onResolved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string | null
  labels: Label[]
  onResolved: () => void
}) {
  const [bundles, setBundles] = useState<Bundle[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const labelById = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels])
  const labelNames = useCallback(
    (n: GraphNode) => (n.labelIds ?? []).map((id) => labelById.get(id)?.name ?? "（削除済み）"),
    [labelById],
  )

  const load = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    try {
      const all: GraphNode[] = await fetch(`/api/nodes?projectId=${projectId}`).then((r) => r.json())
      const unchecked = (Array.isArray(all) ? all : []).filter(
        (n) => (n.status ?? "confirmed") === "provisional",
      )
      // 下ごしらえ：ラベル集合＋正規化名が一致するものだけ、最初から入れ子で提示する
      const buckets = new Map<string, GraphNode[]>()
      for (const n of unchecked) {
        const key = `${[...(n.labelIds ?? [])].sort().join("|")}::${n.normalizedName ?? normalizeName(n.name)}`
        const arr = buckets.get(key)
        if (arr) arr.push(n)
        else buckets.set(key, [n])
      }
      const initial: Bundle[] = []
      for (const members of buckets.values()) {
        // 代表の初期値＝最も長い表記（より完全な形とみなす）
        const canonical = members.reduce((a, b) => (b.name.length > a.name.length ? b : a))
        initial.push({ canonical, children: members.filter((m) => m.id !== canonical.id) })
      }
      initial.sort((a, b) => a.canonical.name.localeCompare(b.canonical.name, "ja"))
      setBundles(initial)
    } catch {
      setError("未チェックのノードの取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (open) load()
    else setBundles([])
  }, [open, load])

  const findNode = (id: string): GraphNode | null => {
    for (const b of bundles) {
      if (b.canonical.id === id) return b.canonical
      const c = b.children.find((x) => x.id === id)
      if (c) return c
    }
    return null
  }

  const bundleOf = (id: string) =>
    bundles.find((b) => b.canonical.id === id || b.children.some((c) => c.id === id))

  // source を target の配下へ移す
  const moveInto = (sourceId: string, targetCanonicalId: string) => {
    if (sourceId === targetCanonicalId) return
    const source = findNode(sourceId)
    if (!source) return
    const target = bundles.find((b) => b.canonical.id === targetCanonicalId)
    if (!target || target.children.some((c) => c.id === sourceId)) return

    setBundles((prev) => {
      const next: Bundle[] = []
      let carried: GraphNode[] = []
      for (const b of prev) {
        if (b.canonical.id === sourceId) {
          // 代表ごと移すときは、その配下も一緒に連れていく
          carried = b.children
          continue
        }
        next.push({ ...b, children: b.children.filter((c) => c.id !== sourceId) })
      }
      return next.map((b) =>
        b.canonical.id === targetCanonicalId
          ? { ...b, children: [...b.children, source, ...carried] }
          : b,
      )
    })
  }

  // 束から外して単独に戻す
  const makeStandalone = (sourceId: string) => {
    const b = bundleOf(sourceId)
    if (!b || b.canonical.id === sourceId) return
    const source = findNode(sourceId)
    if (!source) return
    setBundles((prev) => {
      const next = prev.map((g) => ({ ...g, children: g.children.filter((c) => c.id !== sourceId) }))
      next.push({ canonical: source, children: [] })
      next.sort((a, b2) => a.canonical.name.localeCompare(b2.canonical.name, "ja"))
      return next
    })
  }

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveId(null)
    const sourceId = String(e.active.id)
    if (!e.over) { makeStandalone(sourceId); return }
    const overId = String(e.over.id)
    if (overId.startsWith("grp:")) moveInto(sourceId, overId.slice(4))
  }

  const totalCount = bundles.reduce((n, b) => n + 1 + b.children.length, 0)
  const mergeCount = bundles.reduce((n, b) => n + b.children.length, 0)

  const handleConfirm = async () => {
    if (!projectId) return
    setBusy(true)
    setError(null)
    try {
      const standaloneIds: string[] = []
      for (const b of bundles) {
        if (b.children.length === 0) {
          standaloneIds.push(b.canonical.id)
          continue
        }
        // 配下を代表へ統合（merge が代表のチェック済み化もする）
        for (const child of b.children) {
          const res = await fetch("/api/nodes/resolve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId, action: "merge",
              loserId: child.id, canonicalId: b.canonical.id, method: "manual",
            }),
          })
          if (!res.ok) throw new Error()
        }
      }
      if (standaloneIds.length > 0) {
        const res = await fetch("/api/nodes/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, action: "confirm", nodeIds: standaloneIds }),
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

  const activeNode = activeId ? findNode(activeId) : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-4xl">
        <DialogHeader><DialogTitle>ノード名寄せ</DialogTitle></DialogHeader>

        <p className="text-sm text-muted-foreground">
          同じものだと思うノードは、カードを重ねて束ねてください。束ねた先（チェックの付いたカード）が代表になり、
          残りは代表の別名として統合されます。重ねていないものは「別物」としてそのまま確定します。
          <strong className="font-medium text-foreground">自動では統合しません。</strong>
          ラベル・名前が完全に一致するものだけ、あらかじめ束ねて出しています。
        </p>

        <div className="flex-1 overflow-y-auto py-2">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : error ? (
            <p className="py-8 text-center text-sm text-destructive">{error}</p>
          ) : bundles.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
              <CheckCheck className="h-8 w-8 text-emerald-500" />
              名寄せチェックが必要なノードはありません。
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={pointerWithin}
              onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
              onDragCancel={() => setActiveId(null)}
              onDragEnd={handleDragEnd}
            >
              <div className="flex flex-wrap items-start gap-3">
                {bundles.map((b) => (
                  <div key={b.canonical.id} className="w-60">
                    <BundleCard bundle={b} labelNames={labelNames} />
                  </div>
                ))}
              </div>
              <DragOverlay>
                {activeNode ? (
                  <div className="rounded-md border border-ring bg-card px-3 py-1.5 text-sm font-medium text-foreground shadow-lg">
                    {activeNode.name}
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          )}
        </div>

        {bundles.length > 0 && (
          <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xs text-muted-foreground">
              {totalCount}件が未チェック{mergeCount > 0 ? `／うち ${mergeCount}件を統合` : ""}
            </span>
            <Button onClick={handleConfirm} disabled={busy}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              この内容で名寄せを確定する
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
