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
import { ChevronDown, ChevronRight, Plus, Pencil, Trash2, Loader2, Info } from "lucide-react"
import { useProject } from "@/app/project-context"

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
  "日時": "日付型", // 旧データとの互換
  "真偽値": "真偽値型",
}

function dataTypeLabel(dataType: string): string {
  return DATA_TYPE_LABELS[dataType] ?? `${dataType}型`
}

// ネイティブ input 共通クラス（base-ui Input と同じスタイル）
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
      <select
        className={inputCls}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">選択してください</option>
        <option value="true">はい</option>
        <option value="false">いいえ</option>
      </select>
    )
  }
  if (isDate) {
    return (
      <input
        type="date"
        className={inputCls}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
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
          {/* ラベル行：Tooltip は Label の外に置く（内側だと hover イベントが干渉する） */}
          <div className="flex items-center gap-1.5">
            <Label className="text-sm font-medium">
              {attr.name}
              {attr.required === "必須" && (
                <span className="ml-0.5 text-destructive">*</span>
              )}
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

// ---------- メイン ----------

type AttrGroups = {
  project: OntologyAttribute[]
  inherited: OntologyAttribute[]
  own: OntologyAttribute[]
  parentName: string
}

export function InstancesScreen() {
  const { currentProject } = useProject()

  const [classes, setClasses] = useState<OntologyClass[]>([])
  const [selectedClass, setSelectedClass] = useState<OntologyClass | null>(null)
  const [instances, setInstances] = useState<OntologyInstance[]>([])
  const [instanceCounts, setInstanceCounts] = useState<Record<string, number>>({})
  const [loadingClasses, setLoadingClasses] = useState(true)
  const [loadingInstances, setLoadingInstances] = useState(false)

  const [attrGroups, setAttrGroups] = useState<AttrGroups>({ project: [], inherited: [], own: [], parentName: "" })
  const [loadingAttrs, setLoadingAttrs] = useState(false)

  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState("")
  const [newAttrValues, setNewAttrValues] = useState<Record<string, string>>({})
  const [adding, setAdding] = useState(false)

  const [editTarget, setEditTarget] = useState<OntologyInstance | null>(null)
  const [editName, setEditName] = useState("")
  const [editClassId, setEditClassId] = useState<string | null>(null)
  const [editAttrValues, setEditAttrValues] = useState<Record<string, string>>({})
  const [editAttrGroups, setEditAttrGroups] = useState<AttrGroups>({ project: [], inherited: [], own: [], parentName: "" })
  const [loadingEditAttrs, setLoadingEditAttrs] = useState(false)
  const [saving, setSaving] = useState(false)

  // 未分類が選択されているか
  const [isUnclassifiedSelected, setIsUnclassifiedSelected] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<OntologyInstance | null>(null)
  const [deleting, setDeleting] = useState(false)

  // クラスクリックのたびにインクリメントして属性を強制再取得
  const [attrRefreshKey, setAttrRefreshKey] = useState(0)

  const allAttrs = [...attrGroups.project, ...attrGroups.inherited, ...attrGroups.own]

  // クラス一覧
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

  // インスタンス一覧
  const fetchInstances = useCallback(async (classId: string) => {
    setLoadingInstances(true)
    try {
      const data: OntologyInstance[] = await fetch(`/api/instances?classId=${classId}`).then((r) => r.json())
      setInstances(data)
      setInstanceCounts((prev) => ({ ...prev, [classId]: data.length }))
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingInstances(false)
    }
  }, [])

  // 全件数
  const fetchAllCounts = useCallback(async (classList: OntologyClass[]) => {
    const counts: Record<string, number> = {}
    await Promise.all(
      classList.map(async (cls) => {
        try {
          const data: OntologyInstance[] = await fetch(`/api/instances?classId=${cls.id}`).then((r) => r.json())
          counts[cls.id] = data.length
        } catch {
          counts[cls.id] = 0
        }
      }),
    )
    setInstanceCounts(counts)
  }, [])

  // 属性（3種）。classes をクロージャではなく引数で受け取り stale reference を防ぐ
  const fetchAttrs = useCallback(async (
    cls: OntologyClass,
    projectId: string,
    allClasses: OntologyClass[],
  ) => {
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

  // 編集ダイアログ用の属性取得（クラス変更時に呼ぶ）
  const fetchEditAttrs = useCallback(async (cls: OntologyClass | null, allClasses: OntologyClass[]) => {
    if (!cls || !currentProject) {
      setEditAttrGroups({ project: [], inherited: [], own: [], parentName: "" })
      return
    }
    setLoadingEditAttrs(true)
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
      setEditAttrGroups({
        project: Array.isArray(projData) ? projData : [],
        inherited,
        own: Array.isArray(ownData) ? ownData : [],
        parentName,
      })
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingEditAttrs(false)
    }
  }, [currentProject?.id])

  useEffect(() => { fetchClasses() }, [currentProject?.id])
  useEffect(() => { if (classes.length > 0) fetchAllCounts(classes) }, [classes])
  useEffect(() => {
    if (isUnclassifiedSelected && currentProject) {
      fetchInstances(UNCLASSIFIED)
      setAttrGroups({ project: [], inherited: [], own: [], parentName: "" })
    } else if (selectedClass && currentProject) {
      fetchInstances(selectedClass.id)
      fetchAttrs(selectedClass, currentProject.id, classes)
    } else {
      setInstances([])
      setAttrGroups({ project: [], inherited: [], own: [], parentName: "" })
    }
  }, [selectedClass?.id, currentProject?.id, attrRefreshKey, classes, isUnclassifiedSelected])

  // クラス選択
  const handleSelectClass = (cls: OntologyClass) => {
    setSelectedClass(cls)
    setIsUnclassifiedSelected(false)
    setAttrRefreshKey((k) => k + 1)
  }

  const handleSelectUnclassified = () => {
    setSelectedClass(null)
    setIsUnclassifiedSelected(true)
    setAttrRefreshKey((k) => k + 1)
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
          registeredBy: "",
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

  const openEdit = (inst: OntologyInstance) => {
    const today = new Date().toISOString().split("T")[0]
    const base: Record<string, string> = {}
    allAttrs.forEach((a) => { if (a.dataType === "日付" || a.dataType === "日時") base[a.id] = today })
    setEditTarget(inst)
    setEditName(inst.name)
    setEditClassId(inst.classId)
    setEditAttrValues({ ...base, ...(inst.attributes ?? {}) })
    // 編集ダイアログ用属性を取得（現在の選択クラスの属性を初期値として使う）
    const cls = inst.classId ? classes.find((c) => c.id === inst.classId) ?? null : null
    setEditAttrGroups({ ...attrGroups })
    if (cls?.id !== selectedClass?.id) {
      fetchEditAttrs(cls, classes)
    }
  }

  // 編集ダイアログ内でクラスを変更したとき
  const handleEditClassChange = (newClassId: string) => {
    const cls = newClassId === UNCLASSIFIED ? null : (classes.find((c) => c.id === newClassId) ?? null)
    setEditClassId(newClassId === UNCLASSIFIED ? null : newClassId)
    // 属性値は保持したまま、表示する属性定義だけ更新
    fetchEditAttrs(cls, classes)
  }

  const allEditAttrs = [...editAttrGroups.project, ...editAttrGroups.inherited, ...editAttrGroups.own]

  const handleSave = async () => {
    if (!editTarget || !editName.trim()) return
    setSaving(true)
    const prevClassId = editTarget.classId
    try {
      const res = await fetch(`/api/instances/${editTarget.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim(), classId: editClassId, attributes: editAttrValues }),
      })
      if (!res.ok) throw new Error()
      setEditTarget(null)

      // 現在表示中のクラスのインスタンス一覧＋カウントを更新
      const currentId = selectedClass?.id ?? UNCLASSIFIED
      await fetchInstances(currentId)

      // クラスが変わった場合は移動元・移動先のカウントも個別に更新
      if (editClassId !== prevClassId) {
        const affected = new Set<string>()
        affected.add(prevClassId ?? UNCLASSIFIED)
        affected.add(editClassId ?? UNCLASSIFIED)
        affected.delete(currentId) // fetchInstances で既に更新済み

        await Promise.all([...affected].map(async (cid) => {
          try {
            const data: OntologyInstance[] = await fetch(`/api/instances?classId=${cid}`).then((r) => r.json())
            setInstanceCounts((prev) => ({ ...prev, [cid]: data.length }))
          } catch { /* ignore */ }
        }))
      }
    } catch {
      alert("インスタンスの更新に失敗しました")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/instances/${deleteTarget.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      setDeleteTarget(null)
      const currentId = selectedClass?.id ?? UNCLASSIFIED
      await fetchInstances(currentId)
    } catch {
      alert("インスタンスの削除に失敗しました")
    } finally {
      setDeleting(false)
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
        {/* 左ペイン：クラス選択（ツリー） */}
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
                {/* 未分類 */}
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

        {/* 右ペイン */}
        {(selectedClass || isUnclassifiedSelected) ? (
          <div className="flex flex-col overflow-hidden">
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
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50 hover:bg-muted/50">
                        <TableHead className="font-semibold text-foreground">インスタンス名</TableHead>
                        {allAttrs.map((a) => (
                          <TableHead key={a.id} className="font-semibold text-foreground">
                            {a.name}
                          </TableHead>
                        ))}
                        <TableHead className="w-16" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {instances.map((inst) => (
                        <TableRow key={inst.id}>
                          <TableCell className="font-medium text-foreground">{inst.name}</TableCell>
                          {allAttrs.map((a) => (
                            <TableCell key={a.id} className="text-muted-foreground">
                              {inst.attributes?.[a.id] || "—"}
                            </TableCell>
                          ))}
                          <TableCell>
                            <div className="flex items-center justify-end gap-0.5">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                aria-label="編集"
                                onClick={() => openEdit(inst)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                aria-label="削除"
                                onClick={() => setDeleteTarget(inst)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
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

      {/* ---- 編集ダイアログ ---- */}
      <Dialog open={!!editTarget} onOpenChange={(open) => { if (!open) setEditTarget(null) }}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>インスタンスを編集</DialogTitle>
          </DialogHeader>
          <div className="flex-1 space-y-5 overflow-y-auto py-2 px-1 -mx-1">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">基本情報</p>
              <div className="space-y-1.5">
                <Label htmlFor="edit-inst-name">
                  インスタンス名<span className="ml-0.5 text-destructive">*</span>
                </Label>
                <Input
                  id="edit-inst-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>クラス</Label>
                <Select
                  value={editClassId ?? UNCLASSIFIED}
                  onValueChange={(v) => { if (v) handleEditClassChange(v) }}
                >
                  <SelectTrigger>
                    <SelectValue>
                      {editClassId
                        ? (classes.find((c) => c.id === editClassId)?.name ?? "不明なクラス")
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
            </div>

            {loadingEditAttrs ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />属性を読み込み中…
              </div>
            ) : (
              <>
                <AttrSection
                  title="プロジェクト共通属性"
                  attrs={editAttrGroups.project}
                  values={editAttrValues}
                  onChange={(id, v) => setEditAttrValues((prev) => ({ ...prev, [id]: v }))}
                />
                {editAttrGroups.inherited.length > 0 && (
                  <AttrSection
                    title={`継承属性（${editAttrGroups.parentName}）`}
                    attrs={editAttrGroups.inherited}
                    values={editAttrValues}
                    onChange={(id, v) => setEditAttrValues((prev) => ({ ...prev, [id]: v }))}
                  />
                )}
                <AttrSection
                  title="クラス固有属性"
                  attrs={editAttrGroups.own}
                  values={editAttrValues}
                  onChange={(id, v) => setEditAttrValues((prev) => ({ ...prev, [id]: v }))}
                />
                {allEditAttrs.length === 0 && (
                  <p className="text-sm text-muted-foreground">このクラスには属性が設定されていません</p>
                )}
              </>
            )}
          </div>
          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setEditTarget(null)} disabled={saving}>
              キャンセル
            </Button>
            <Button
              onClick={handleSave}
              disabled={!editName.trim() || saving || hasMissingRequired(allEditAttrs, editAttrValues)}
            >
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              保存
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
