"use client"

// 整理ビュー（オントロジー設計）。クラスとリレーションを整理用グループのレーンに並べ、
// ドラッグ＆ドロップでグループの移動と並び替えを行う。
//
// ここで変えるのは groupId と order だけで、オントロジーの意味（継承・始点終点など）には触らない。
// 並び順は疎な値（lib/organize.ts の ORDER_STEP 刻み）なので、1回のドラッグで書き込むのは原則1件。
// まだ採番されていないレーン（order 未設定の既存データ）に落としたときだけ、そのレーンを振り直す。

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { GripVertical, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TopBar } from "@/components/top-bar"
import { useProject } from "@/app/project-context"
import { GroupManagerDialog, useGroups } from "@/components/group-manager"
import { cn } from "@/lib/utils"
import { ORDER_STEP, UNGROUPED, orderBetween, sortByOrder, sortGroups } from "@/lib/organize"
import type { ScreenId } from "@/components/sidebar"
import type { OntologyClass, OntologyGroup, OntologyRelation } from "@/lib/types"

type CardKind = "class" | "relation"

type Card = {
  // レーンをまたいで一意にするため、種別を接頭辞に付けたキーを DnD の id として使う
  key: string
  kind: CardKind
  id: string
  name: string
  nameEn?: string
  order?: number
  createdAt?: string
}

type Lanes = Record<string, Card[]>

type KindFilter = "both" | "class" | "relation"

const KIND_LABEL: Record<CardKind, string> = { class: "クラス", relation: "リレーション" }

function toCard(kind: CardKind, item: OntologyClass | OntologyRelation): Card {
  return {
    key: `${kind}:${item.id}`,
    kind,
    id: item.id,
    name: item.name,
    nameEn: item.nameEn,
    order: item.order,
    createdAt: item.createdAt,
  }
}

function buildLanes(
  cards: { card: Card; groupId: string | null }[],
  groups: OntologyGroup[],
): Lanes {
  const known = new Set(groups.map((g) => g.id))
  const lanes: Lanes = {}
  for (const g of sortGroups(groups)) lanes[g.id] = []
  lanes[UNGROUPED] = []
  for (const { card, groupId } of cards) {
    const key = groupId && known.has(groupId) ? groupId : UNGROUPED
    lanes[key].push(card)
  }
  for (const key of Object.keys(lanes)) lanes[key] = sortByOrder(lanes[key])
  return lanes
}

function SortableCard({ card, onOpen }: { card: Card; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.key })
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1.5 text-sm shadow-sm"
    >
      <button
        {...attributes}
        {...listeners}
        aria-label={`${card.name}を移動`}
        className="cursor-grab text-muted-foreground/40 transition-colors hover:text-muted-foreground active:cursor-grabbing"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen}>
        <span className="block truncate font-medium text-foreground">{card.name}</span>
        {card.nameEn && <span className="block truncate text-xs text-muted-foreground">{card.nameEn}</span>}
      </button>
      <span
        className={cn(
          "shrink-0 rounded-full border px-1.5 py-px text-[10px]",
          card.kind === "class"
            ? "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300"
            : "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300",
        )}
      >
        {KIND_LABEL[card.kind]}
      </span>
    </div>
  )
}

function Lane({
  laneKey,
  group,
  cards,
  onOpen,
}: {
  laneKey: string
  group: OntologyGroup | null
  cards: Card[]
  onOpen: (card: Card) => void
}) {
  // 空のレーンにも落とせるよう、レーン自体をドロップ先として登録する
  const { setNodeRef, isOver } = useDroppable({ id: laneKey })
  return (
    <div className="flex max-h-full w-64 shrink-0 flex-col rounded-lg border border-border bg-muted/30">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full border border-border"
          style={group?.color ? { backgroundColor: group.color } : undefined}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {group?.name ?? "未分類"}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{cards.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-24 flex-1 flex-col gap-1.5 overflow-y-auto p-2 transition-colors",
          isOver && "bg-indigo-50 dark:bg-indigo-950/30",
        )}
      >
        <SortableContext items={cards.map((c) => c.key)} strategy={verticalListSortingStrategy}>
          {cards.map((card) => (
            <SortableCard key={card.key} card={card} onOpen={() => onOpen(card)} />
          ))}
        </SortableContext>
        {cards.length === 0 && (
          <p className="py-4 text-center text-xs text-muted-foreground">ここにドラッグ</p>
        )}
      </div>
    </div>
  )
}

export function OrganizeScreen({
  active,
  onNavigate,
}: {
  active?: boolean
  onNavigate?: (screen: ScreenId, id?: string) => void
}) {
  const { currentProject, loading: projectLoading } = useProject()
  const { groups, setGroups, refresh: refreshGroups } = useGroups(currentProject?.id)
  const [classes, setClasses] = useState<OntologyClass[]>([])
  const [relations, setRelations] = useState<OntologyRelation[]>([])
  const [loading, setLoading] = useState(true)
  const [kindFilter, setKindFilter] = useState<KindFilter>("both")
  const [showGroupManager, setShowGroupManager] = useState(false)
  const [lanes, setLanesState] = useState<Lanes>({ [UNGROUPED]: [] })
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  // ドラッグ中は onDragOver が連続で走るため、最新のレーン内容を ref でも持つ
  // （onDragEnd のクロージャが1つ前の state を見てしまうのを避ける）
  const lanesRef = useRef<Lanes>(lanes)
  const setLanes = useCallback((next: Lanes) => {
    lanesRef.current = next
    setLanesState(next)
  }, [])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const fetchAll = useCallback(async () => {
    if (!currentProject) return
    setLoading(true)
    try {
      const [c, r] = await Promise.all([
        fetch(`/api/classes?projectId=${currentProject.id}`).then((res) => res.json()),
        fetch(`/api/relations?projectId=${currentProject.id}`).then((res) => res.json()),
      ])
      setClasses(Array.isArray(c) ? c : [])
      setRelations(Array.isArray(r) ? r : [])
    } finally {
      setLoading(false)
    }
  }, [currentProject?.id])

  useEffect(() => {
    if (projectLoading) return
    setClasses([]); setRelations([])
    setLoading(!!currentProject)
  }, [currentProject?.id, projectLoading])

  useEffect(() => {
    if (active && currentProject) {
      fetchAll()
      refreshGroups()
    }
  }, [active, currentProject?.id, fetchAll, refreshGroups])

  const sourceCards = useMemo(() => {
    const items: { card: Card; groupId: string | null }[] = []
    if (kindFilter !== "relation") {
      for (const c of classes) items.push({ card: toCard("class", c), groupId: c.groupId ?? null })
    }
    if (kindFilter !== "class") {
      for (const r of relations) items.push({ card: toCard("relation", r), groupId: r.groupId ?? null })
    }
    return items
  }, [classes, relations, kindFilter])

  // 取得結果・フィルタ・グループが変わったらレーンを組み直す
  useEffect(() => {
    setLanes(buildLanes(sourceCards, groups))
  }, [sourceCards, groups, setLanes])

  const laneKeys = useMemo(() => [...sortGroups(groups).map((g) => g.id), UNGROUPED], [groups])
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups])

  const laneKeyOf = (key: string): string | null => {
    if (key in lanesRef.current) return key
    return Object.keys(lanesRef.current).find((k) => lanesRef.current[k].some((c) => c.key === key)) ?? null
  }

  const findCard = (key: string): Card | null => {
    for (const list of Object.values(lanesRef.current)) {
      const hit = list.find((c) => c.key === key)
      if (hit) return hit
    }
    return null
  }

  // 並び順をサーバへ反映する。原則は動いた1件だけ。
  // レーンに未採番（order 未設定）が混ざっているときだけ、そのレーンを振り直す。
  const persist = async (next: Lanes, laneKey: string, movedKey: string) => {
    if (!currentProject) return
    const groupId = laneKey === UNGROUPED ? null : laneKey
    const lane = next[laneKey] ?? []
    const index = lane.findIndex((c) => c.key === movedKey)
    if (index < 0) return
    const moved = lane[index]

    const unnumbered = lane.some((c) => c.order === undefined)
    const between = unnumbered ? null : orderBetween(lane[index - 1], lane[index + 1])
    const assigned: { card: Card; order: number }[] =
      between === null
        ? lane.map((card, i) => ({ card, order: (i + 1) * ORDER_STEP }))
        : [{ card: moved, order: between }]

    // 画面側の order も更新しておく（次のドラッグで中間値を計算できるように）
    const orderByKey = new Map(assigned.map((a) => [a.card.key, a.order]))
    setLanes({
      ...next,
      [laneKey]: lane.map((c) => {
        const order = orderByKey.get(c.key)
        return order === undefined ? c : { ...c, order }
      }),
    })

    setSaveError(null)
    try {
      const results = await Promise.all(
        (["class", "relation"] as CardKind[]).map(async (kind) => {
          const updates = assigned
            .filter((a) => a.card.kind === kind)
            .map((a) => ({ id: a.card.id, order: a.order, groupId }))
          if (updates.length === 0) return true
          const path = kind === "class" ? "classes" : "relations"
          const res = await fetch(`/api/${path}/reorder`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: currentProject.id, updates }),
          })
          return res.ok
        }),
      )
      if (results.some((ok) => !ok)) throw new Error()
      // 取得済みデータ側にも order と groupId を反映する。
      // ここを飛ばすと、classes/relations の変化でレーンを組み直したときに
      // 古い order で並べ直されて、動かしたカードが元の位置へ戻ってしまう。
      const orderById = (kind: CardKind) =>
        new Map(assigned.filter((a) => a.card.kind === kind).map((a) => [a.card.id, a.order]))
      const classOrders = orderById("class")
      const relationOrders = orderById("relation")
      setClasses((prev) =>
        prev.map((c) => {
          const order = classOrders.get(c.id)
          if (order === undefined) return c
          return c.id === moved.id ? { ...c, groupId, order } : { ...c, order }
        }),
      )
      setRelations((prev) =>
        prev.map((r) => {
          const order = relationOrders.get(r.id)
          if (order === undefined) return r
          return r.id === moved.id ? { ...r, groupId, order } : { ...r, order }
        }),
      )
    } catch {
      setSaveError("並び順の保存に失敗しました。取得し直します。")
      fetchAll()
    }
  }

  const handleDragStart = (event: DragStartEvent) => {
    setActiveKey(String(event.active.id))
  }

  // レーンをまたいだ時点で先に入れ替えて、見た目を指に追従させる
  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)
    const from = laneKeyOf(activeId)
    const to = laneKeyOf(overId)
    if (!from || !to || from === to) return

    const current = lanesRef.current
    const card = current[from].find((c) => c.key === activeId)
    if (!card) return
    const target = current[to]
    const overIndex = target.findIndex((c) => c.key === overId)
    const insertAt = overIndex < 0 ? target.length : overIndex
    setLanes({
      ...current,
      [from]: current[from].filter((c) => c.key !== activeId),
      [to]: [...target.slice(0, insertAt), card, ...target.slice(insertAt)],
    })
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveKey(null)
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)
    const laneKey = laneKeyOf(activeId)
    if (!laneKey) return

    const current = lanesRef.current
    const lane = current[laneKey]
    const from = lane.findIndex((c) => c.key === activeId)
    const overIndex = lane.findIndex((c) => c.key === overId)
    const to = overIndex < 0 ? lane.length - 1 : overIndex
    const next = from < 0 || from === to ? current : { ...current, [laneKey]: arrayMove(lane, from, to) }
    setLanes(next)
    persist(next, laneKey, activeId)
  }

  const activeCard = activeKey ? findCard(activeKey) : null
  const total = Object.values(lanes).reduce((n, list) => n + list.length, 0)

  return (
    <div className="flex h-full flex-col">
      <TopBar group="オントロジー設計" title="整理ビュー">
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 bg-transparent"
          onClick={() => setShowGroupManager(true)}
          disabled={!currentProject}
        >
          グループを管理
        </Button>
      </TopBar>

      <div className="flex items-center gap-2 px-6 py-3 text-xs">
        <span className="text-muted-foreground">表示：</span>
        {([
          { key: "both", label: "両方" },
          { key: "class", label: "クラス" },
          { key: "relation", label: "リレーション" },
        ] as { key: KindFilter; label: string }[]).map((opt) => (
          <button
            key={opt.key}
            type="button"
            className={cn(
              "rounded-full border px-2.5 py-0.5 transition-colors",
              kindFilter === opt.key
                ? "border-indigo-400 bg-indigo-100 text-indigo-800 dark:border-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200"
                : "border-border text-muted-foreground hover:bg-muted",
            )}
            onClick={() => setKindFilter(opt.key)}
          >
            {opt.label}
          </button>
        ))}
        <span className="ml-2 text-muted-foreground">
          カードをドラッグしてグループの移動・並び替えができます（グループ自体の並びは「グループを管理」から）
        </span>
      </div>

      {saveError && <p className="px-6 pb-2 text-xs text-destructive">{saveError}</p>}

      <div className="flex-1 overflow-auto px-6 pb-6">
        {loading && total === 0 ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : !currentProject ? (
          <p className="p-4 text-center text-sm text-muted-foreground">プロジェクトを選択してください</p>
        ) : (
          <>
            {groups.length === 0 && (
              <p className="pb-3 text-xs text-muted-foreground">
                グループがまだありません。「グループを管理」から追加すると、ここにレーンが並びます。
              </p>
            )}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
            >
              <div className="flex h-full items-start gap-3">
                {laneKeys.map((key) => (
                  <Lane
                    key={key}
                    laneKey={key}
                    group={key === UNGROUPED ? null : (groupById.get(key) ?? null)}
                    cards={lanes[key] ?? []}
                    onOpen={(card) =>
                      onNavigate?.(card.kind === "class" ? "classes" : "relations", card.id)
                    }
                  />
                ))}
              </div>
              <DragOverlay>
                {activeCard && (
                  <div className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1.5 text-sm shadow-lg">
                    <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40" />
                    <span className="font-medium text-foreground">{activeCard.name}</span>
                  </div>
                )}
              </DragOverlay>
            </DndContext>
          </>
        )}
      </div>

      {currentProject && (
        <GroupManagerDialog
          open={showGroupManager}
          onOpenChange={setShowGroupManager}
          projectId={currentProject.id}
          groups={groups}
          onSaved={(saved) => {
            setGroups(saved)
            fetchAll()
          }}
        />
      )}
    </div>
  )
}
