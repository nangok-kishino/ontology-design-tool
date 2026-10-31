"use client"

// 一覧表の行をドラッグ＆ドロップで並べ替えるための部品。
//
// ボード（group-board.tsx）は1レーン＝1本の並びなので sortable を使っているが、
// 一覧表は階層（クラスの親子）とグループ見出しを1枚の表に流し込んでいるため、
// 行を抜き差ししながら追従させると、どの並びに入るのかがかえって読めなくなる。
// そこで「掴む（draggable）／落とす（droppable）」だけを扱い、
// 落とした先の行を基準に並びを決める形にしている。
// どの行に落とすと何が起きるかは、呼び出し側の onDrop が決める。

import { createContext, useContext, useState, type ReactNode } from "react"
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import { GripVertical } from "lucide-react"
import { TableCell, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"

// カーソルの真下にある行だけを落とし先にする。距離で近い行を拾う方式にすると、
// 落とせない行の上にいるときに近くの関係ない行へ吸い寄せられてしまう。
// 掴んでいる行と、その行をどこに落とせるか。落とせない先は反応させない
// （反応するのに何も起きない、が一番分かりにくいため）。
const DragStateContext = createContext<{
  activeId: string | null
  canDrop: (activeId: string, overId: string) => boolean
}>({ activeId: null, canDrop: () => true })

// その行が今まさに落とし先になれるか
function useDropEnabled(id: string, enabled: boolean) {
  const { activeId, canDrop } = useContext(DragStateContext)
  if (!enabled) return false
  if (activeId === null || activeId === id) return true
  return canDrop(activeId, id)
}

export function ListDndContext({
  labelOf,
  canDrop = () => true,
  onDrop,
  children,
}: {
  // ドラッグ中に指について回る見出し
  labelOf: (id: string) => ReactNode
  // 落とせる組み合わせか。false の行はドロップ先にならず、反応もしない
  canDrop?: (activeId: string, overId: string) => boolean
  onDrop: (activeId: string, overId: string) => void
  children: ReactNode
}) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={(e) => setActiveId(String(e.active.id))}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={(e) => {
        setActiveId(null)
        if (e.over && e.over.id !== e.active.id) onDrop(String(e.active.id), String(e.over.id))
      }}
    >
      <DragStateContext.Provider value={{ activeId, canDrop }}>{children}</DragStateContext.Provider>
      <DragOverlay>
        {activeId && (
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1.5 text-sm shadow-lg">
            <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40" />
            {labelOf(activeId)}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

// 掴めて、かつ落とし先にもなる行。先頭に取っ手の列を自分で足す。
export function DragRow({
  id,
  label,
  enabled,
  className,
  onClick,
  children,
}: {
  id: string
  label: string
  // 絞り込み中など、並べ替えを許さないときは false（列は残して取っ手だけ出さない）
  enabled: boolean
  className?: string
  onClick?: () => void
  children: ReactNode
}) {
  const drag = useDraggable({ id, disabled: !enabled })
  const drop = useDroppable({ id, disabled: !useDropEnabled(id, enabled) })
  const isTarget = drop.isOver && drop.active?.id !== id
  return (
    <TableRow
      ref={(node) => {
        drag.setNodeRef(node)
        drop.setNodeRef(node)
      }}
      className={cn(
        className,
        drag.isDragging && "opacity-40",
        isTarget && "bg-indigo-50 hover:bg-indigo-50 dark:bg-indigo-950/40 dark:hover:bg-indigo-950/40",
      )}
      onClick={onClick}
    >
      <TableCell className="w-8 px-1" onClick={(e) => e.stopPropagation()}>
        {enabled && (
          <button
            {...drag.attributes}
            {...drag.listeners}
            aria-label={`${label}を移動`}
            className="cursor-grab text-muted-foreground/40 transition-colors hover:text-muted-foreground active:cursor-grabbing"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        )}
      </TableCell>
      {children}
    </TableRow>
  )
}

// 落とし先にだけなる行（グループ見出し）。そのグループの末尾へ送るのに使う。
export function DropRow({
  id,
  enabled,
  className,
  children,
}: {
  id: string
  enabled: boolean
  className?: string
  children: ReactNode
}) {
  const drop = useDroppable({ id, disabled: !useDropEnabled(id, enabled) })
  return (
    <TableRow
      ref={drop.setNodeRef}
      className={cn(
        className,
        drop.isOver && "bg-indigo-100 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-950/60",
      )}
    >
      {children}
    </TableRow>
  )
}
