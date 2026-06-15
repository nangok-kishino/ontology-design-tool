"use client"

import { useState, useEffect, useCallback } from "react"
import { createPortal } from "react-dom"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { TopBar } from "@/components/top-bar"
import { cn } from "@/lib/utils"
import type { OntologyClass, OntologyInstance, OntologyAttribute } from "@/lib/types"
import { ChevronDown, ChevronRight, Plus, Trash2, Loader2, Info, X, GripVertical } from "lucide-react"
import { useProject } from "@/app/project-context"
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"

// ダイアログ内でも確実に動作するツールチップ（base-ui Tooltip は inert 問題あり）
function InfoTooltip({ content }: { content: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  return (
    <>
      <span
        className="inline-flex cursor-help"
        onMouseEnter={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setPos({ x: r.left + r.width / 2, y: r.top - 6 })
        }}
        onMouseLeave={() => setPos(null)}
      >
        <Info className="h-3.5 w-3.5 text-muted-foreground/50 transition-colors hover:text-muted-foreground" />
      </span>
      {pos &&
        createPortal(
          <div
            className="pointer-events-none rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs leading-relaxed text-popover-foreground shadow-lg"
            style={{
              position: "fixed",
              left: pos.x,
              top: pos.y,
              transform: "translate(-50%, -100%)",
              zIndex: 9999,
              maxWidth: "13rem",
            }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  )
}

const UNCLASSIFIED = "unclassified" as const

// ---------- ツリー ----------

type TreeNode = OntologyClass & { children: TreeNode[] }

function buildTree(items: OntologyClass[]): TreeNode[] {
  const map = new Map(items.map((c) => [c.id, { ...c, children: [] as TreeNode[] }]))
  const roots: TreeNode[] = []
  for (const node of map.values()) {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

function ClassTreeItem({
  node,
  depth,
  selectedId,
  instanceCounts,
  onSelect,
}: {
  node: TreeNode
  depth: number
  selectedId: string | null
  instanceCounts: Record<string, number>
  onSelect: (cls: OntologyClass) => void
}) {
  const [open, setOpen] = useState(true)
  const hasChildren = node.children.length > 0
  const isSelected = node.id === selectedId
  const count = instanceCounts[node.id] ?? 0

  return (
    <div>
      <div
        className={cn(
          "flex cursor-pointer items-center gap-1 rounded-md py-1.5 pr-2 text-sm transition-colors",
          isSelected ? "bg-accent font-medium text-accent-foreground" : "hover:bg-muted",
        )}
        style={{ paddingLeft: depth * 16 + 8 }}
        onClick={() => onSelect(node)}
      >
        {hasChildren ? (
          <button
            onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
            className="flex h-4 w-4 items-center justify-center text-muted-foreground"
          >
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="h-4 w-4" />
        )}
        <span className="flex-1">{node.name}</span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs tabular-nums",
            isSelected ? "bg-accent-foreground/10 text-accent-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          {count}
        </span>
      </div>
      {hasChildren && open && (
        <div>
          {node.children.map((child) => (
            <ClassTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              instanceCounts={instanceCounts}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- 属性入力 ----------

const DATA_TYPE_LABELS: Record<string, string> = {
  "文字列": "文字列型",
  "数値": "数値型",
  "日付": "日付型",
  "日時": "日付型",
  "真偽値": "真偽値型",
}

function dataTypeLabel(dataType: string): string {
  return DATA_TYPE_LABELS[dataType] ?? `${dataType}型`
}

const inputCls =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"

function AttrInput({
  attr,
  value,
  onChange,
}: {
  attr: OntologyAttribute
  value: string
  onChange: (v: string) => void
}) {
  const isDate = attr.dataType === "日付" || attr.dataType === "日時"
  if (attr.dataType === "真偽値") {
    return (
      <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">選択してください</option>
        <option value="true">はい</option>
        <option value="false">いいえ</option>
      </select>
    )
  }
  if (isDate) {
    return (
      <input type="date" className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} />
    )
  }
  if (attr.dataType === "数値") {
    return (
      <input
        type="number"
        step="any"
        className={inputCls}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        onWheel={(e) => (e.target as HTMLInputElement).blur()}
      />
    )
  }
  return (
    <input
      type="text"
      className={inputCls}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={`${attr.name}を入力`}
    />
  )
}

function AttrSection({
  title,
  attrs,
  values,
  onChange,
}: {
  title: string
  attrs: OntologyAttribute[]
  values: Record<string, string>
  onChange: (id: string, v: string) => void
}) {
  if (attrs.length === 0) return null
  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      {attrs.map((attr) => (
        <div key={attr.id} className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Label className="text-sm font-medium">
              {attr.name}
              {attr.required === "必須" && <span className="ml-0.5 text-destructive">*</span>}
            </Label>
            <span className="text-xs text-muted-foreground">({dataTypeLabel(attr.dataType)})</span>
            {attr.description && <InfoTooltip content={attr.description} />}
          </div>
          <AttrInput attr={attr} value={values[attr.id] ?? ""} onChange={(v) => onChange(attr.id, v)} />
        </div>
      ))}
    </div>
  )
}

// ---------- ソータブル行 ----------

function SortableInstRow({
  inst,
  isSelected,
  onClick,
}: {
  inst: OntologyInstance
  isSelected: boolean
  onClick: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: inst.id })
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    position: "relative",
    zIndex: isDragging ? 1 : undefined,
  }
  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      className={cn(
        "cursor-pointer transition-colors",
        isSelected ? "bg-accent hover:bg-accent" : "hover:bg-muted/50",
      )}
      onClick={onClick}
    >
      <TableCell className="w-8 px-2" onClick={(e) => e.stopPropagation()}>
        <button
          {...attributes}
          {...listeners}
          className="flex items-center justify-center cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors"
          tabIndex={-1}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </TableCell>
      <TableCell className="font-medium text-foreground">{inst.name}</TableCell>
      <TableCell className="text-sm text-muted-foreground">{inst.updatedAt || "—"}</TableCell>
    </TableRow>
  )
}

// ---------- メイン ----------

type AttrGroups = {
  project: OntologyAttribute[]
  inherited: OntologyAttribute[]
  own: OntologyAttribute[]
  parentName: string
}

export function InstancesScreen({ initialSelectedClassId }: { initialSelectedClassId?: string }) {
  const { currentProject } = useProject()

  const [classes, setClasses] = useState<OntologyClass[]>([])
  const [selectedClass, setSelectedClass] = useState<OntologyClass | null>(null)
  const [instances, setInstances] = useState<OntologyInstance[]>([])
  const [instanceCounts, setInstanceCounts] = useState<Record<string, number>>({})
  const [loadingClasses, setLoadingClasses] = useState(true)
  const [loadingInstances, setLoadingInstances] = useState(false)
  const [isUnclassifiedSelected, setIsUnclassifiedSelected] = useState(false)
  const [attrRefreshKey, setAttrRefreshKey] = useState(0)

  // 追加ダイアログ用属性（選択クラス）
  const [attrGroups, setAttrGroups] = useState<AttrGroups>({ project: [], inherited: [], own: [], parentName: "" })
  const [loadingAttrs, setLoadingAttrs] = useState(false)
  const allAttrs = [...attrGroups.project, ...attrGroups.inherited, ...attrGroups.own]

  // 追加ダイアログ
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState("")
  const [newAttrValues, setNewAttrValues] = useState<Record<string, string>>({})
  const [adding, setAdding] = useState(false)

  // 詳細パネル
  const [selectedInst, setSelectedInst] = useState<OntologyInstance | null>(null)
  const [detailName, setDetailName] = useState("")
  const [detailClassId, setDetailClassId] = useState<string | null>(null)
  const [detailAttrValues, setDetailAttrValues] = useState<Record<string, string>>({})
  const [detailAttrGroups, setDetailAttrGroups] = useState<AttrGroups>({ project: [], inherited: [], own: [], parentName: "" })
  const [loadingDetailAttrs, setLoadingDetailAttrs] = useState(false)
  const [savingDetail, setSavingDetail] = useState(false)
  const allDetailAttrs = [...detailAttrGroups.project, ...detailAttrGroups.inherited, ...detailAttrGroups.own]

  // 削除ダイアログ
  const [deleteTarget, setDeleteTarget] = useState<OntologyInstance | null>(null)
  const [deleting, setDeleting] = useState(false)

  // DnD sensors（8px 動かないと drag 開始しない → 行クリックと競合しない）
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )

  // === fetch ===

  const fetchClasses = useCallback(async () => {
    if (!currentProject) return
    setLoadingClasses(true)
    try {
      const data: OntologyClass[] = await fetch(`/api/classes?projectId=${currentProject.id}`).then((r) => r.json())
      setClasses(data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingClasses(false)
    }
  }, [currentProject?.id])

  const fetchInstances = useCallback(async (classId: string) => {
    setLoadingInstances(true)
    try {
      const data: OntologyInstance[] = await fetch(`/api/instances?classId=${classId}`).then((r) => r.json())
      data.sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER))
      setInstances(data)
      setInstanceCounts((prev) => ({ ...prev, [classId]: data.length }))
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingInstances(false)
    }
  }, [])

  const fetchAllCounts = useCallback(async (classList: OntologyClass[], projectId: string) => {
    const [classResults, nullData, projectData] = await Promise.all([
      Promise.all(
        classList.map(async (cls) => {
          try {
            const data: OntologyInstance[] = await fetch(`/api/instances?classId=${cls.id}`).then((r) => r.json())
            return { id: cls.id, count: data.length }
          } catch {
            return { id: cls.id, count: 0 }
          }
        }),
      ),
      fetch(`/api/instances?classId=${UNCLASSIFIED}`).then((r) => r.json()).catch(() => []),
      fetch(`/api/instances?projectId=${projectId}`).then((r) => r.json()).catch(() => []),
    ])
    const counts: Record<string, number> = {}
    classResults.forEach(({ id, count }) => { counts[id] = count })
    const nullInstances: OntologyInstance[] = Array.isArray(nullData) ? nullData : []
    const projectInstances: OntologyInstance[] = Array.isArray(projectData) ? projectData : []
    const knownIds = new Set(classList.map((c) => c.id))
    const nullIdSet = new Set(nullInstances.map((i) => i.id))
    const orphaned = projectInstances.filter(
      (i) => i.classId && !knownIds.has(i.classId) && !nullIdSet.has(i.id),
    )
    counts[UNCLASSIFIED] = nullInstances.length + orphaned.length
    setInstanceCounts(counts)
  }, [])

  const fetchUnclassifiedInstances = useCallback(async (allClasses: OntologyClass[], projectId: string) => {
    setLoadingInstances(true)
    try {
      const [nullData, projectData] = await Promise.all([
        fetch(`/api/instances?classId=${UNCLASSIFIED}`).then((r) => r.json()),
        fetch(`/api/instances?projectId=${projectId}`).then((r) => r.json()),
      ])
      const nullInstances: OntologyInstance[] = Array.isArray(nullData) ? nullData : []
      const projectInstances: OntologyInstance[] = Array.isArray(projectData) ? projectData : []
      const knownIds = new Set(allClasses.map((c) => c.id))
      const nullIdSet = new Set(nullInstances.map((i) => i.id))
      const orphaned = projectInstances.filter(
        (i) => i.classId && !knownIds.has(i.classId) && !nullIdSet.has(i.id),
      )
      const combined = [...nullInstances, ...orphaned]
      combined.sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER))
      setInstances(combined)
      setInstanceCounts((prev) => ({ ...prev, [UNCLASSIFIED]: combined.length }))
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingInstances(false)
    }
  }, [])

  const fetchAttrs = useCallback(async (cls: OntologyClass, projectId: string, allClasses: OntologyClass[]) => {
    setLoadingAttrs(true)
    try {
      const [projData, ownData] = await Promise.all([
        fetch(`/api/attributes?targetId=${projectId}`).then((r) => r.json()),
        fetch(`/api/attributes?targetId=${cls.id}`).then((r) => r.json()),
      ])
      let inherited: OntologyAttribute[] = []
      let parentName = ""
      if (cls.parentId) {
        const parentCls = allClasses.find((c) => c.id === cls.parentId)
        parentName = parentCls?.name ?? ""
        const parentData = await fetch(`/api/attributes?targetId=${cls.parentId}`).then((r) => r.json())
        inherited = Array.isArray(parentData) ? parentData : []
      }
      setAttrGroups({
        project: Array.isArray(projData) ? projData : [],
        inherited,
        own: Array.isArray(ownData) ? ownData : [],
        parentName,
      })
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingAttrs(false)
    }
  }, [])

  const fetchDetailAttrs = useCallback(async (cls: OntologyClass | null, allClasses: OntologyClass[]) => {
    if (!cls || !currentProject) {
      setDetailAttrGroups({ project: [], inherited: [], own: [], parentName: "" })
      return
    }
    setLoadingDetailAttrs(true)
    try {
      const [projData, ownData] = await Promise.all([
        fetch(`/api/attributes?targetId=${currentProject.id}`).then((r) => r.json()),
        fetch(`/api/attributes?targetId=${cls.id}`).then((r) => r.json()),
      ])
      let inherited: OntologyAttribute[] = []
      let parentName = ""
      if (cls.parentId) {
        const parentCls = allClasses.find((c) => c.id === cls.parentId)
        parentName = parentCls?.name ?? ""
        const parentData = await fetch(`/api/attributes?targetId=${cls.parentId}`).then((r) => r.json())
        inherited = Array.isArray(parentData) ? parentData : []
      }
      setDetailAttrGroups({
        project: Array.isArray(projData) ? projData : [],
        inherited,
        own: Array.isArray(ownData) ? ownData : [],
        parentName,
      })
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingDetailAttrs(false)
    }
  }, [currentProject?.id])

  // === effects ===

  useEffect(() => { fetchClasses() }, [currentProject?.id])
  useEffect(() => {
    if (classes.length > 0 && currentProject) fetchAllCounts(classes, currentProject.id)
  }, [classes, currentProject?.id])
  useEffect(() => {
    if (initialSelectedClassId && classes.length > 0) {
      const cls = classes.find((c) => c.id === initialSelectedClassId)
      if (cls) {
        setSelectedClass(cls)
        setIsUnclassifiedSelected(false)
        setAttrRefreshKey((k) => k + 1)
      }
    }
  }, [initialSelectedClassId, classes.length])
  useEffect(() => {
    if (isUnclassifiedSelected && currentProject) {
      fetchUnclassifiedInstances(classes, currentProject.id)
      setAttrGroups({ project: [], inherited: [], own: [], parentName: "" })
    } else if (selectedClass && currentProject) {
      fetchInstances(selectedClass.id)
      fetchAttrs(selectedClass, currentProject.id, classes)
    } else {
      setInstances([])
      setAttrGroups({ project: [], inherited: [], own: [], parentName: "" })
    }
  }, [selectedClass?.id, currentProject?.id, attrRefreshKey, classes, isUnclassifiedSelected])

  // === handlers ===

  const handleSelectClass = (cls: OntologyClass) => {
    setSelectedClass(cls)
    setIsUnclassifiedSelected(false)
    setAttrRefreshKey((k) => k + 1)
    setSelectedInst(null)
  }

  const handleSelectUnclassified = () => {
    setSelectedClass(null)
    setIsUnclassifiedSelected(true)
    setAttrRefreshKey((k) => k + 1)
    setSelectedInst(null)
  }

  const handleSelectInst = (inst: OntologyInstance) => {
    setSelectedInst(inst)
    setDetailName(inst.name)
    setDetailClassId(inst.classId)
    setDetailAttrValues(inst.attributes ?? {})
    const cls = inst.classId ? classes.find((c) => c.id === inst.classId) ?? null : null
    fetchDetailAttrs(cls, classes)
  }

  const openAdd = () => {
    const today = new Date().toISOString().split("T")[0]
    const defaults: Record<string, string> = {}
    allAttrs.forEach((a) => { if (a.dataType === "日付" || a.dataType === "日時") defaults[a.id] = today })
    setNewName("")
    setNewAttrValues(defaults)
    setShowAdd(true)
  }

  const handleAdd = async () => {
    if (!newName.trim() || !selectedClass || !currentProject) return
    setAdding(true)
    try {
      const res = await fetch("/api/instances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          classId: selectedClass.id,
          projectId: currentProject.id,
          attributes: newAttrValues,
        }),
      })
      if (!res.ok) throw new Error()
      setShowAdd(false)
      await fetchInstances(selectedClass.id)
    } catch {
      alert("インスタンスの追加に失敗しました")
    } finally {
      setAdding(false)
    }
  }

  const handleDetailClassChange = (newClassId: string) => {
    const cls = newClassId === UNCLASSIFIED ? null : (classes.find((c) => c.id === newClassId) ?? null)
    setDetailClassId(newClassId === UNCLASSIFIED ? null : newClassId)
    fetchDetailAttrs(cls, classes)
  }

  const handleDetailSave = async () => {
    if (!selectedInst || !detailName.trim()) return
    setSavingDetail(true)
    const prevClassId = selectedInst.classId
    try {
      const res = await fetch(`/api/instances/${selectedInst.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: detailName.trim(), classId: detailClassId, attributes: detailAttrValues }),
      })
      if (!res.ok) throw new Error()
      const updated: OntologyInstance = await res.json()
      setSelectedInst(updated)
      if (isUnclassifiedSelected && currentProject) {
        await fetchUnclassifiedInstances(classes, currentProject.id)
      } else {
        await fetchInstances(selectedClass?.id ?? UNCLASSIFIED)
      }
      if (detailClassId !== prevClassId && currentProject) {
        await fetchAllCounts(classes, currentProject.id)
      }
    } catch {
      alert("インスタンスの更新に失敗しました")
    } finally {
      setSavingDetail(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/instances/${deleteTarget.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      if (selectedInst?.id === deleteTarget.id) setSelectedInst(null)
      setDeleteTarget(null)
      if (isUnclassifiedSelected && currentProject) {
        await fetchUnclassifiedInstances(classes, currentProject.id)
      } else {
        await fetchInstances(selectedClass?.id ?? UNCLASSIFIED)
      }
    } catch {
      alert("インスタンスの削除に失敗しました")
    } finally {
      setDeleting(false)
    }
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = instances.findIndex((i) => i.id === active.id)
    const newIndex = instances.findIndex((i) => i.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = arrayMove(instances, oldIndex, newIndex)
    setInstances(reordered)
    const updates = reordered.map((inst, index) => ({ id: inst.id, order: index }))
    try {
      await fetch("/api/instances/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      })
    } catch {
      // 失敗時は元に戻す
      setInstances(instances)
    }
  }

  const hasMissingRequired = (attrs: OntologyAttribute[], values: Record<string, string>) =>
    attrs.some((a) => a.required === "必須" && !(values[a.id] ?? "").trim())

  const currentLabel = isUnclassifiedSelected ? "未分類" : selectedClass?.name ?? null
  const canAdd = !!selectedClass && !isUnclassifiedSelected
  const tree = buildTree(classes)
  const unclassifiedCount = instanceCounts[UNCLASSIFIED] ?? 0

  return (
    <div className="flex h-full flex-col">
      <TopBar title="登録済みインスタンス" />

      <div className="grid flex-1 overflow-hidden" style={{ gridTemplateColumns: "260px 1fr" }}>
        {/* 左ペイン：クラス選択 */}
        <div className="flex flex-col border-r border-border bg-card">
          <div className="px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">クラス選択</h2>
          </div>
          <div className="flex-1 overflow-auto p-2">
            {loadingClasses ? (
              <div className="flex h-32 items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : (
              <>
                {tree.length === 0 && !currentProject && (
                  <p className="p-4 text-center text-sm text-muted-foreground">プロジェクトを選択してください</p>
                )}
                {tree.map((node) => (
                  <ClassTreeItem
                    key={node.id}
                    node={node}
                    depth={0}
                    selectedId={selectedClass?.id ?? null}
                    instanceCounts={instanceCounts}
                    onSelect={handleSelectClass}
                  />
                ))}
                <button
                  onClick={handleSelectUnclassified}
                  className={cn(
                    "mt-1 flex w-full items-center justify-between rounded-md px-3 py-1.5 text-sm transition-colors border-t border-border/50 pt-2",
                    isUnclassifiedSelected
                      ? "bg-accent font-medium text-accent-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  <span>未分類</span>
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-xs tabular-nums",
                    isUnclassifiedSelected ? "bg-accent-foreground/10 text-accent-foreground" : "bg-muted text-muted-foreground",
                  )}>
                    {unclassifiedCount}
                  </span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* 中央＋詳細パネルエリア */}
        {(selectedClass || isUnclassifiedSelected) ? (
          <div className="relative flex flex-col overflow-hidden">
            {/* インスタンス一覧 */}
            <div className="flex items-center justify-between px-6 py-3">
              <h2 className="text-base font-semibold text-foreground">{currentLabel}</h2>
              {canAdd && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 bg-transparent"
                  onClick={openAdd}
                  disabled={loadingAttrs}
                >
                  <Plus className="h-3.5 w-3.5" />追加
                </Button>
              )}
            </div>

            <div className="flex-1 overflow-auto px-6 pb-6">
              {loadingInstances ? (
                <div className="flex h-32 items-center justify-center text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : instances.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  インスタンスが登録されていません
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={instances.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/50 hover:bg-muted/50">
                            <TableHead className="w-8 px-2" />
                            <TableHead className="font-semibold text-foreground">インスタンス名</TableHead>
                            <TableHead className="w-32 font-semibold text-foreground">更新日</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {instances.map((inst) => (
                            <SortableInstRow
                              key={inst.id}
                              inst={inst}
                              isSelected={selectedInst?.id === inst.id}
                              onClick={() => handleSelectInst(inst)}
                            />
                          ))}
                        </TableBody>
                      </Table>
                    </SortableContext>
                  </DndContext>
                </div>
              )}
            </div>

            {/* 詳細パネル（右からスライドイン） */}
            <div
              className={cn(
                "absolute right-0 top-0 h-full w-96 border-l border-border bg-card shadow-2xl flex flex-col transition-transform duration-200 ease-in-out",
                selectedInst ? "translate-x-0" : "translate-x-full",
              )}
            >
              {selectedInst && (
                <>
                  {/* ヘッダー：インスタンス名 + 閉じるボタン */}
                  <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                    <Input
                      value={detailName}
                      onChange={(e) => setDetailName(e.target.value)}
                      className="h-8 flex-1 text-sm font-medium"
                      placeholder="インスタンス名"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={() => setSelectedInst(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* 本体（スクロール可） */}
                  <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
                    {/* システム属性（読み取り専用） */}
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">システム属性</p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg bg-muted/30 px-3 py-3 text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground">登録日</p>
                          <p className="mt-0.5 font-medium">{selectedInst.registeredAt || "—"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">登録者</p>
                          <p className="mt-0.5 font-medium">{selectedInst.registeredBy || "—"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">更新日</p>
                          <p className="mt-0.5 font-medium">{selectedInst.updatedAt || "—"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">更新者</p>
                          <p className="mt-0.5 font-medium">{selectedInst.updatedBy || "—"}</p>
                        </div>
                      </div>
                    </div>

                    {/* クラス */}
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">クラス</p>
                      <Select
                        value={detailClassId ?? UNCLASSIFIED}
                        onValueChange={(v) => { if (v) handleDetailClassChange(v) }}
                      >
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue>
                            {detailClassId
                              ? (classes.find((c) => c.id === detailClassId)?.name ?? "不明なクラス")
                              : "未分類"}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={UNCLASSIFIED}>未分類</SelectItem>
                          {classes.map((cls) => (
                            <SelectItem key={cls.id} value={cls.id}>{cls.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* ユーザー定義属性 */}
                    {loadingDetailAttrs ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />属性を読み込み中…
                      </div>
                    ) : (
                      <>
                        <AttrSection
                          title="プロジェクト共通属性"
                          attrs={detailAttrGroups.project}
                          values={detailAttrValues}
                          onChange={(id, v) => setDetailAttrValues((prev) => ({ ...prev, [id]: v }))}
                        />
                        {detailAttrGroups.inherited.length > 0 && (
                          <AttrSection
                            title={`継承属性（${detailAttrGroups.parentName}）`}
                            attrs={detailAttrGroups.inherited}
                            values={detailAttrValues}
                            onChange={(id, v) => setDetailAttrValues((prev) => ({ ...prev, [id]: v }))}
                          />
                        )}
                        <AttrSection
                          title="クラス固有属性"
                          attrs={detailAttrGroups.own}
                          values={detailAttrValues}
                          onChange={(id, v) => setDetailAttrValues((prev) => ({ ...prev, [id]: v }))}
                        />
                        {allDetailAttrs.length === 0 && (
                          <p className="text-sm text-muted-foreground">このクラスには属性が設定されていません</p>
                        )}
                      </>
                    )}
                  </div>

                  {/* フッター：削除・保存 */}
                  <div className="flex items-center justify-between border-t border-border px-4 py-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setDeleteTarget(selectedInst)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />削除
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleDetailSave}
                      disabled={!detailName.trim() || savingDetail || hasMissingRequired(allDetailAttrs, detailAttrValues)}
                    >
                      {savingDetail && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                      保存
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center text-sm text-muted-foreground">
            左からクラスを選択してください
          </div>
        )}
      </div>

      {/* ---- 追加ダイアログ ---- */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>インスタンスを追加 — {selectedClass?.name}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 space-y-5 overflow-y-auto py-2 px-1 -mx-1">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">基本情報</p>
              <div className="space-y-1.5">
                <Label htmlFor="inst-name">
                  インスタンス名<span className="ml-0.5 text-destructive">*</span>
                </Label>
                <Input
                  id="inst-name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="例：製品A"
                />
              </div>
            </div>

            {loadingAttrs ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />属性を読み込み中…
              </div>
            ) : (
              <>
                <AttrSection
                  title="プロジェクト共通属性"
                  attrs={attrGroups.project}
                  values={newAttrValues}
                  onChange={(id, v) => setNewAttrValues((prev) => ({ ...prev, [id]: v }))}
                />
                {attrGroups.inherited.length > 0 && (
                  <AttrSection
                    title={`継承属性（${attrGroups.parentName}）`}
                    attrs={attrGroups.inherited}
                    values={newAttrValues}
                    onChange={(id, v) => setNewAttrValues((prev) => ({ ...prev, [id]: v }))}
                  />
                )}
                <AttrSection
                  title="クラス固有属性"
                  attrs={attrGroups.own}
                  values={newAttrValues}
                  onChange={(id, v) => setNewAttrValues((prev) => ({ ...prev, [id]: v }))}
                />
                {allAttrs.length === 0 && (
                  <p className="text-sm text-muted-foreground">このクラスには属性が設定されていません</p>
                )}
              </>
            )}
          </div>
          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setShowAdd(false)} disabled={adding}>
              キャンセル
            </Button>
            <Button
              onClick={handleAdd}
              disabled={!newName.trim() || adding || hasMissingRequired(allAttrs, newAttrValues)}
            >
              {adding && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              追加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- 削除確認ダイアログ ---- */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>インスタンスを削除</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            「{deleteTarget?.name}」を削除します。この操作は元に戻せません。
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              キャンセル
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              削除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
