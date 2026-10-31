"use client"

// 整理ボード。クラス管理／リレーション管理の一覧ビューと切り替えて使う。
//   未分類レーンを左端に固定し、グループのレーンはその右側を横スクロールする
//   （未分類はグループへ振り分ける元なので、スクロールで見失わないようにする）。
//
// クラスのサブクラスはカードの中に入れ子で描く。ドラッグできるのは親カードだけで、
// 子は親と一塊で動く（子のグループは親に従い、個別には持たせない）。
//
// ここで変えるのは groupId と order だけで、オントロジーの意味には触らない。
// 並び順は疎な値（lib/organize.ts の ORDER_STEP 刻み）なので、1回のドラッグで
// 書き込むのは原則1件。まだ採番されていないレーン（order 未設定の既存データ）に
// 落としたときと、隙間が尽きたときだけ、そのレーンを振り直す。

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
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
import { GripVertical } from "lucide-react"
import { cn } from "@/lib/utils"
import { ORDER_STEP, UNGROUPED, orderBetween, sortByOrder, sortGroups } from "@/lib/organize"
import type { OntologyGroup } from "@/lib/types"

export type BoardItem = {
  id: string
  name: string
  nameEn?: string
  groupId?: string | null
  order?: number
  createdAt?: string
  // 子（クラスのサブクラス）。カードの中に入れ子で描き、親ごと一塊で動かす。
  // 子のグループ・並び順は親に従うので、ここで個別に動かすことはできない。
  children?: BoardItem[]
}

// 入れ子を含めた件数。レーンの見出しに出す。
function countAll(items: BoardItem[]): number {
  return items.reduce((n, i) => n + 1 + countAll(i.children ?? []), 0)
}

// レーンを組み直すかどうかの判定に使う、入れ子まで含めた中身の署名。
function signatureOf(items: BoardItem[]): string {
  return items
    .map((i) => `${i.id}:${i.groupId ?? ""}:${i.order ?? ""}(${signatureOf(i.children ?? [])})`)
    .join("|")
}

export type ReorderUpdate = { id: string; order: number; groupId: string | null }

type Lanes = Record<string, BoardItem[]>

// カーソルの真下にあるものを最優先に判定する。空のレーンはカードが無く、
// 角の距離で比べると隣のレーンのカードに負けてしまうため。
const collisionDetection: CollisionDetection = (args) => {
  const underPointer = pointerWithin(args)
  return underPointer.length > 0 ? underPointer : closestCorners(args)
}

function buildLanes(items: BoardItem[], groups: OntologyGroup[]): Lanes {
  const known = new Set(groups.map((g) => g.id))
  const lanes: Lanes = { [UNGROUPED]: [] }
  for (const g of sortGroups(groups)) lanes[g.id] = []
  for (const item of items) {
    const gid = item.groupId ?? null
    // 既に存在しないグループを指している分は未分類に寄せる
    lanes[gid && known.has(gid) ? gid : UNGROUPED].push(item)
  }
  for (const key of Object.keys(lanes)) lanes[key] = sortByOrder(lanes[key])
  return lanes
}

function Card({
  item,
  selectedId,
  onSelect,
}: {
  item: BoardItem
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  const children = item.children ?? []
  const selected = item.id === selectedId
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className={cn(
        "flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-sm shadow-sm transition-colors",
        selected
          ? "border-indigo-400 bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-950/50"
          : "border-border bg-card hover:bg-muted/50",
      )}
    >
      <button
        {...attributes}
        {...listeners}
        aria-label={children.length > 0 ? `${item.name}と配下のサブクラスを移動` : `${item.name}を移動`}
        className="shrink-0 cursor-grab text-muted-foreground/40 transition-colors hover:text-muted-foreground active:cursor-grabbing"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <div className="min-w-0 flex-1">
        <button type="button" className="block w-full min-w-0 text-left" onClick={() => onSelect(item.id)}>
          <span className="block truncate font-medium text-foreground">{item.name}</span>
          {item.nameEn && <span className="block truncate text-xs text-muted-foreground">{item.nameEn}</span>}
        </button>
        {children.length > 0 && <ChildList items={children} selectedId={selectedId} onSelect={onSelect} />}
      </div>
    </div>
  )
}

// カード内に描くサブクラス。親と一緒に動くので、ここにはドラッグの取っ手を付けない。
function ChildList({
  items,
  selectedId,
  onSelect,
}: {
  items: BoardItem[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <ul className="mt-1 space-y-0.5 border-l border-border pl-1.5">
      {items.map((child) => (
        <li key={child.id}>
          <button
            type="button"
            className={cn(
              "flex w-full min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left text-xs transition-colors",
              child.id === selectedId
                ? "bg-indigo-200/70 text-indigo-900 dark:bg-indigo-900/50 dark:text-indigo-100"
                : "text-muted-foreground hover:bg-muted",
            )}
            onClick={() => onSelect(child.id)}
          >
            <span className="shrink-0 text-muted-foreground/70">└</span>
            <span className="truncate">{child.name}</span>
          </button>
          {(child.children?.length ?? 0) > 0 && (
            <ChildList items={child.children ?? []} selectedId={selectedId} onSelect={onSelect} />
          )}
        </li>
      ))}
    </ul>
  )
}

function Lane({
  laneKey,
  group,
  items,
  selectedId,
  onSelect,
}: {
  laneKey: string
  group: OntologyGroup | null
  items: BoardItem[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  // 空のレーンにも落とせるよう、レーン自体をドロップ先として登録する
  const { setNodeRef, isOver } = useDroppable({ id: laneKey })
  return (
    <div
      className={cn(
        "flex h-full w-56 shrink-0 flex-col overflow-hidden rounded-lg border",
        group ? "border-border bg-muted/30" : "border-dashed border-border bg-muted/50",
      )}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full border border-border"
          style={group?.color ? { backgroundColor: group.color } : undefined}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {group?.name ?? "未分類"}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{countAll(items)}</span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2 transition-colors",
          isOver && "bg-indigo-50 dark:bg-indigo-950/30",
        )}
      >
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          {items.map((item) => (
            <Card key={item.id} item={item} selectedId={selectedId} onSelect={onSelect} />
          ))}
        </SortableContext>
        {items.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">ここにドラッグ</p>}
      </div>
    </div>
  )
}

export function GroupBoard({
  items,
  groups,
  selectedId,
  onSelect,
  onReorder,
  emptyGroupsHint,
}: {
  items: BoardItem[]
  groups: OntologyGroup[]
  selectedId: string | null
  onSelect: (id: string) => void
  // 並び順の確定。false を返すと取得済みの内容から組み直す
  onReorder: (updates: ReorderUpdate[]) => Promise<boolean>
  emptyGroupsHint?: string
}) {
  const [lanes, setLanesState] = useState<Lanes>(() => buildLanes(items, groups))
  const [activeId, setActiveId] = useState<string | null>(null)

  // onDragOver は連続で走るため、最新のレーン内容を ref でも持つ
  // （onDragEnd のクロージャが1つ前の state を見てしまうのを避ける）
  const lanesRef = useRef<Lanes>(lanes)
  const setLanes = useCallback((next: Lanes) => {
    lanesRef.current = next
    setLanesState(next)
  }, [])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  // 親は毎レンダリング新しい配列を渡しうるので、配列の同一性では組み直さない。
  // ドラッグ中に組み直すと、掴んで動かしたカードが元の位置へ戻ってしまう
  //（特に空のレーンでは、戻る→またカーソル下に入るの繰り返しで一切移動できなくなる）。
  const signature = useMemo(
    () => signatureOf(items) + "#" + groups.map((g) => g.id).join("|"),
    [items, groups],
  )
  const itemsRef = useRef(items)
  const groupsRef = useRef(groups)
  itemsRef.current = items
  groupsRef.current = groups

  useEffect(() => {
    setLanes(buildLanes(itemsRef.current, groupsRef.current))
  }, [signature, setLanes])

  const groupLanes = useMemo(() => sortGroups(groups), [groups])

  const laneKeyOf = (id: string): string | null => {
    if (id in lanesRef.current) return id
    return Object.keys(lanesRef.current).find((k) => lanesRef.current[k].some((i) => i.id === id)) ?? null
  }

  const findItem = (id: string): BoardItem | null => {
    for (const list of Object.values(lanesRef.current)) {
      const hit = list.find((i) => i.id === id)
      if (hit) return hit
    }
    return null
  }

  const persist = async (next: Lanes, laneKey: string, movedId: string) => {
    const groupId = laneKey === UNGROUPED ? null : laneKey
    const lane = next[laneKey] ?? []
    const index = lane.findIndex((i) => i.id === movedId)
    if (index < 0) return

    const unnumbered = lane.some((i) => i.order === undefined)
    const between = unnumbered ? null : orderBetween(lane[index - 1], lane[index + 1])
    const assigned: ReorderUpdate[] =
      between === null
        ? lane.map((item, i) => ({ id: item.id, order: (i + 1) * ORDER_STEP, groupId }))
        : [{ id: lane[index].id, order: between, groupId }]

    // 画面側の order も進めておく（次のドラッグで中間値を計算できるように）
    const orderById = new Map(assigned.map((a) => [a.id, a.order]))
    setLanes({
      ...next,
      [laneKey]: lane.map((item) => {
        const order = orderById.get(item.id)
        return order === undefined ? item : { ...item, order, groupId }
      }),
    })

    const ok = await onReorder(assigned)
    if (!ok) setLanes(buildLanes(items, groups))
  }

  // 掴んだ時点の位置。終了時に「本当に動いたか」を判定するのに使う
  // （onDragOver でレーンをまたいだ後だと、終了時の位置だけでは判断できない）。
  const dragOriginRef = useRef<{ lane: string; index: number } | null>(null)

  const handleDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id)
    const lane = laneKeyOf(id)
    dragOriginRef.current = lane
      ? { lane, index: lanesRef.current[lane].findIndex((i) => i.id === id) }
      : null
    setActiveId(id)
  }

  // レーンをまたいだ時点で先に入れ替えて、見た目を指に追従させる
  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event
    if (!over) return
    const activeKey = String(active.id)
    const overKey = String(over.id)
    const from = laneKeyOf(activeKey)
    const to = laneKeyOf(overKey)
    if (!from || !to || from === to) return

    const current = lanesRef.current
    const item = current[from].find((i) => i.id === activeKey)
    if (!item) return
    const target = current[to]
    const overIndex = target.findIndex((i) => i.id === overKey)
    const insertAt = overIndex < 0 ? target.length : overIndex
    setLanes({
      ...current,
      [from]: current[from].filter((i) => i.id !== activeKey),
      [to]: [...target.slice(0, insertAt), item, ...target.slice(insertAt)],
    })
  }

  // 落とした時点の active / over だけで最終形を決める。
  // onDragOver が走ったかどうかに依存しないので、レーンをまたぐ移動も取りこぼさない。
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)
    if (!over) return
    const activeKey = String(active.id)
    const overKey = String(over.id)
    const from = laneKeyOf(activeKey)
    const to = laneKeyOf(overKey)
    if (!from || !to) return

    const current = lanesRef.current
    let next: Lanes
    if (from === to) {
      const lane = current[from]
      const fromIndex = lane.findIndex((i) => i.id === activeKey)
      const overIndex = lane.findIndex((i) => i.id === overKey)
      const toIndex = overIndex < 0 ? lane.length - 1 : overIndex
      next = fromIndex < 0 || fromIndex === toIndex ? current : { ...current, [from]: arrayMove(lane, fromIndex, toIndex) }
    } else {
      const item = current[from].find((i) => i.id === activeKey)
      if (!item) return
      const target = current[to]
      const overIndex = target.findIndex((i) => i.id === overKey)
      const insertAt = overIndex < 0 ? target.length : overIndex
      next = {
        ...current,
        [from]: current[from].filter((i) => i.id !== activeKey),
        [to]: [...target.slice(0, insertAt), item, ...target.slice(insertAt)],
      }
    }
    setLanes(next)
    // 掴んだ場所に戻しただけなら保存しない。逆に、onDragOver でレーンをまたいでいれば
    // 終了時の見た目が動いていなくても保存する必要がある。
    const origin = dragOriginRef.current
    const finalIndex = (next[to] ?? []).findIndex((i) => i.id === activeKey)
    dragOriginRef.current = null
    if (origin && origin.lane === to && origin.index === finalIndex) return
    persist(next, to, activeKey)
  }

  const activeItem = activeId ? findItem(activeId) : null

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-full min-h-0 gap-3">
        {/* 未分類は常に左端。グループへ振り分ける元なので横スクロールで流さない */}
        <Lane
          laneKey={UNGROUPED}
          group={null}
          items={lanes[UNGROUPED] ?? []}
          selectedId={selectedId}
          onSelect={onSelect}
        />
        <div className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
          {groupLanes.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted-foreground">
              {emptyGroupsHint ?? "グループがまだありません。「グループを管理」から追加してください。"}
            </p>
          ) : (
            <div className="flex h-full gap-3 pr-2">
              {groupLanes.map((group) => (
                <Lane
                  key={group.id}
                  laneKey={group.id}
                  group={group}
                  items={lanes[group.id] ?? []}
                  selectedId={selectedId}
                  onSelect={onSelect}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <DragOverlay>
        {activeItem && (
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1.5 text-sm shadow-lg">
            <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40" />
            <span className="font-medium text-foreground">{activeItem.name}</span>
            {countAll(activeItem.children ?? []) > 0 && (
              <span className="text-xs text-muted-foreground">＋サブクラス{countAll(activeItem.children ?? [])}件</span>
            )}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

export type BoardViewMode = "list" | "board"

// 一覧表 ⇔ ボードの切替。一覧の見出し横に置く想定の小さなセグメント。
export function ViewToggle({
  value,
  onChange,
}: {
  value: BoardViewMode
  onChange: (value: BoardViewMode) => void
}) {
  return (
    <div className="flex shrink-0 overflow-hidden rounded-md border border-border text-xs">
      {([
        { key: "list", label: "一覧表" },
        { key: "board", label: "ボード" },
      ] as { key: BoardViewMode; label: string }[]).map((opt, i) => (
        <button
          key={opt.key}
          type="button"
          className={cn(
            "whitespace-nowrap px-2.5 py-1 transition-colors",
            i > 0 && "border-l border-border",
            value === opt.key
              ? "bg-indigo-100 font-medium text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200"
              : "text-muted-foreground hover:bg-muted",
          )}
          onClick={() => onChange(opt.key)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
