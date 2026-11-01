"use client"

// リレーションシップタイプ管理（スキーマ設計）。
//   旧リレーション管理の後継。始点・終点の事前指定（ラベルペア）は踏襲する。
//   ラベルに階層が無くなったので「親クラスで宣言すれば子にも効く」という継承の説明は不要になり、
//   代わりに「ノードが持つラベルに含まれていれば通る」になる（docs/graph-model.md）。
//   グループは移行元のリレーションと同じ一覧（Project.relationGroups）をそのまま使う。

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label as FieldLabel } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { TopBar } from "@/components/top-bar"
import { Tooltip } from "@/components/ui/tooltip"
import { SectionHeader } from "@/components/section-header"
import { GroupManagerDialog, useGroups } from "@/components/group-manager"
import { GroupBoard, ViewToggle, type BoardItem, type BoardViewMode, type ReorderUpdate } from "@/components/group-board"
import { DragRow, DropRow, ListDndContext } from "@/components/list-dnd"
import { ConfirmationBadge } from "@/components/confirmation-badge"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { ConfirmationSummary } from "@/components/confirmation-summary"
import { PropertySection, type PropertySectionHandle } from "@/components/property-section"
import { LabelChip } from "@/components/label-chip"
import { cn } from "@/lib/utils"
import { UNGROUPED, nextOrder, placeAt, reorderUpdates, sortByOrder, sortGroups } from "@/lib/organize"
import { deriveConfirmationStatus, type ConfirmationState } from "@/lib/confirmation"
import type { ConditionSlot, Label, LabelPair, PropertyDef, RelationshipType } from "@/lib/graph-types"
import {
  AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, ChevronRight, FileText, Filter, Info,
  Loader2, Plus, Tags, Trash2, X,
} from "lucide-react"
import { useProject } from "@/app/project-context"

const GROUP_ROW_PREFIX = "group:"

const REL_TYPE_FIELD_LABEL: Record<string, string> = {
  name: "タイプ名",
  nameEn: "英語名",
  description: "説明",
  labelPairs: "ラベルペア",
  conditions: "成立条件",
  properties: "プロパティ",
}

// 新しい条件項目の初期値
const newConditionSlot = (): ConditionSlot => ({ id: crypto.randomUUID(), variable: "" })

function formatDateTime(iso: string | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("ja-JP", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  })
}

function toggleIn(set: Set<string>, id: string): Set<string> {
  const next = new Set(set)
  next.has(id) ? next.delete(id) : next.add(id)
  return next
}

type ListRow =
  | { kind: "group"; key: string; groupKey: string; name: string; color?: string; count: number }
  | { kind: "relType"; key: string; relType: RelationshipType }

export function RelationshipTypesScreen({
  initialSelectedId,
  active,
}: { initialSelectedId?: string; active?: boolean }) {
  const { currentProject, loading: projectLoading } = useProject()
  const projectId = currentProject?.id

  const [relTypes, setRelTypes] = useState<RelationshipType[]>([])
  const [labels, setLabels] = useState<Label[]>([])
  const [relCounts, setRelCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null)

  const { groups, setGroups, refresh: refreshGroups } = useGroups(projectId, "relation")
  const [showGroupManager, setShowGroupManager] = useState(false)
  const [viewMode, setViewMode] = useState<BoardViewMode>("list")
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<Set<string>>(new Set())

  const [filterState, setFilterState] = useState<"all" | ConfirmationState>("all")
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [showConfirm, setShowConfirm] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [unconfirming, setUnconfirming] = useState(false)

  // 追加ダイアログ
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState("")
  const [newNameEn, setNewNameEn] = useState("")
  const [newDesc, setNewDesc] = useState("")
  const [newPairs, setNewPairs] = useState<LabelPair[]>([{ sourceLabelId: "", targetLabelId: "" }])
  const [newConditions, setNewConditions] = useState<ConditionSlot[]>([])
  const [newGroupId, setNewGroupId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const newNameRef = useRef<HTMLInputElement>(null)

  // 詳細パネル
  const [editName, setEditName] = useState("")
  const [editNameEn, setEditNameEn] = useState("")
  const [editDesc, setEditDesc] = useState("")
  const [editPairs, setEditPairs] = useState<LabelPair[]>([])
  const [editConditions, setEditConditions] = useState<ConditionSlot[]>([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // タイプグループ・プロパティも、下の「保存」を押すまでは保留にする
  const [editGroupId, setEditGroupId] = useState<string | null>(null)
  const [propsDirty, setPropsDirty] = useState(false)
  const propertyRef = useRef<PropertySectionHandle>(null)

  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showBulkDelete, setShowBulkDelete] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null)

  const selected = useMemo(() => relTypes.find((r) => r.id === selectedId) ?? null, [relTypes, selectedId])

  const labelById = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels])
  const labelName = useCallback((id: string) => labelById.get(id)?.name ?? "（削除済み）", [labelById])
  const labelMissing = useCallback((id: string) => !!id && !labelById.has(id), [labelById])
  const sortedLabels = useMemo(() => [...labels].sort((a, b) => a.name.localeCompare(b.name, "ja")), [labels])

  // ─── 取得 ───
  const fetchAll = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const [types, labelList, counts] = await Promise.all([
        fetch(`/api/relationship-types?projectId=${projectId}`).then((r) => r.json()),
        fetch(`/api/labels?projectId=${projectId}`).then((r) => r.json()),
        fetch(`/api/relationship-types/counts?projectId=${projectId}`)
          .then((r) => r.json()).catch(() => ({ counts: {} })),
      ])
      setRelTypes(Array.isArray(types) ? types : [])
      setLabels(Array.isArray(labelList) ? labelList : [])
      setRelCounts(counts?.counts ?? {})
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (projectLoading) return
    setRelTypes([]); setLabels([]); setRelCounts({}); setSelectedId(null); setCheckedIds(new Set())
    setLoading(!!projectId)
  }, [projectId, projectLoading])

  useEffect(() => {
    if (active && projectId) {
      fetchAll()
      refreshGroups()
    }
  }, [active, projectId, fetchAll, refreshGroups])

  useEffect(() => {
    if (!selected) return
    setEditName(selected.name)
    setEditNameEn(selected.nameEn ?? "")
    setEditDesc(selected.description ?? "")
    setEditPairs(
      (selected.labelPairs ?? []).length > 0
        ? selected.labelPairs.map((p) => ({ ...p }))
        : [{ sourceLabelId: "", targetLabelId: "" }],
    )
    setEditConditions((selected.conditions ?? []).map((c) => ({ ...c })))
    setEditGroupId(selected.groupId ?? null)
    setPropsDirty(false)
    setSaveError(null)
  }, [selected?.id])

  // ─── 並び・グループ ───
  const knownGroupIds = useMemo(() => new Set(groups.map((g) => g.id)), [groups])
  const groupKeyOf = useCallback(
    (r: RelationshipType) => (r.groupId && knownGroupIds.has(r.groupId) ? r.groupId : UNGROUPED),
    [knownGroupIds],
  )

  const visible = useMemo(() => {
    if (filterState === "all") return relTypes
    return relTypes.filter((r) => deriveConfirmationStatus(r.confirmations).state === filterState)
  }, [relTypes, filterState])

  const canReorder = filterState === "all" && viewMode === "list"

  const listRows = useMemo<ListRow[]>(() => {
    const buckets = new Map<string, RelationshipType[]>()
    for (const r of visible) {
      const key = groupKeyOf(r)
      const list = buckets.get(key)
      if (list) list.push(r)
      else buckets.set(key, [r])
    }
    const rows: ListRow[] = []
    const emit = (groupKey: string, name: string, color?: string) => {
      const items = sortByOrder(buckets.get(groupKey) ?? [])
      rows.push({ kind: "group", key: GROUP_ROW_PREFIX + groupKey, groupKey, name, color, count: items.length })
      if (collapsedGroupKeys.has(groupKey)) return
      for (const r of items) rows.push({ kind: "relType", key: r.id, relType: r })
    }
    for (const g of sortGroups(groups)) emit(g.id, g.name, g.color)
    emit(UNGROUPED, "未分類")
    return rows
  }, [visible, groups, groupKeyOf, collapsedGroupKeys])

  const boardItems = useMemo<BoardItem[]>(
    () => visible.map((r) => ({
      id: r.id, name: r.name, nameEn: r.nameEn,
      groupId: groupKeyOf(r) === UNGROUPED ? null : r.groupId, order: r.order, createdAt: r.createdAt,
    })),
    [visible, groupKeyOf],
  )

  const applyReorder = useCallback(async (updates: ReorderUpdate[]): Promise<boolean> => {
    if (!projectId || updates.length === 0) return false
    setRelTypes((prev) =>
      prev.map((r) => {
        const u = updates.find((x) => x.id === r.id)
        return u ? { ...r, order: u.order, groupId: u.groupId } : r
      }),
    )
    try {
      const res = await fetch("/api/relationship-types/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, updates }),
      })
      if (!res.ok) throw new Error("reorder failed")
      return true
    } catch (err) {
      console.error(err)
      fetchAll()
      return false
    }
  }, [projectId, fetchAll])

  const handleRowDrop = (activeId: string, overId: string) => {
    const moved = relTypes.find((r) => r.id === activeId)
    if (!moved) return
    let targetKey: string
    let overRowId: string | undefined
    if (overId.startsWith(GROUP_ROW_PREFIX)) {
      targetKey = overId.slice(GROUP_ROW_PREFIX.length)
    } else {
      const over = relTypes.find((r) => r.id === overId)
      if (!over) return
      targetKey = groupKeyOf(over)
      overRowId = overId
    }
    // 同じグループ内の移動なら、動かす行も含めた並びを渡す（下へ動かしたときに1つ手前に戻らないように）。
    // 別グループからの移動なら含まれないので、落とした行の前に入る
    const list = sortByOrder(relTypes.filter((r) => groupKeyOf(r) === targetKey))
    const { ordered, index } = placeAt(list, moved, overRowId)
    applyReorder(reorderUpdates(ordered, index, targetKey === UNGROUPED ? null : targetKey))
  }


  // ─── ラベルペア・条件項目の編集 ───
  const updatePair = (
    set: (fn: (prev: LabelPair[]) => LabelPair[]) => void,
    i: number,
    key: keyof LabelPair,
    value: string,
  ) => set((prev) => prev.map((p, idx) => (idx === i ? { ...p, [key]: value } : p)))

  const addPair = (set: (fn: (prev: LabelPair[]) => LabelPair[]) => void) =>
    set((prev) => [...prev, { sourceLabelId: "", targetLabelId: "" }])

  const removePair = (set: (fn: (prev: LabelPair[]) => LabelPair[]) => void, i: number) =>
    set((prev) => prev.filter((_, idx) => idx !== i))

  const updateCondition = (
    set: (fn: (prev: ConditionSlot[]) => ConditionSlot[]) => void,
    i: number,
    patch: Partial<ConditionSlot>,
  ) => set((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))

  const validPairs = (pairs: LabelPair[]) =>
    pairs.filter((p) => p.sourceLabelId && p.targetLabelId)

  const cleanConditions = (list: ConditionSlot[]) =>
    list.filter((c) => c.variable.trim()).map((c) => ({ ...c, variable: c.variable.trim() }))

  // ─── 追加 ───
  const openAddDialog = () => {
    setNewName(""); setNewNameEn(""); setNewDesc("")
    setNewPairs([{ sourceLabelId: "", targetLabelId: "" }]); setNewConditions([])
    setNewGroupId(null)
    setAddError(null); setShowAdd(true)
  }

  const handleAdd = async () => {
    if (!projectId || !newName.trim()) return
    setAdding(true); setAddError(null)
    try {
      const res = await fetch("/api/relationship-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, name: newName.trim(), nameEn: newNameEn.trim(), description: newDesc,
          labelPairs: validPairs(newPairs), conditions: cleanConditions(newConditions),
          groupId: newGroupId,
          // 選んだグループの末尾に置く
          order: nextOrder(relTypes.filter((r) => groupKeyOf(r) === (newGroupId ?? UNGROUPED))),
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setAddError(err.error ?? "作成に失敗しました")
        return
      }
      const created: RelationshipType = await res.json()
      setRelTypes((prev) => [...prev, created])
      setShowAdd(false)
      setSelectedId(created.id)
    } finally {
      setAdding(false)
    }
  }

  // ─── 保存・削除 ───
  // 右ペインの変更（基本情報・タイプグループ・プロパティ）は、下の「保存」でまとめて書き込む
  const basicDirty =
    !!selected &&
    (editName !== selected.name ||
      editNameEn !== (selected.nameEn ?? "") ||
      editDesc !== (selected.description ?? "") ||
      JSON.stringify(validPairs(editPairs)) !== JSON.stringify(selected.labelPairs ?? []) ||
      JSON.stringify(cleanConditions(editConditions)) !== JSON.stringify(selected.conditions ?? []))
  const groupDirty = !!selected && (editGroupId ?? null) !== (selected.groupId ?? null)
  const dirty = basicDirty || groupDirty || propsDirty

  const handleSave = async () => {
    if (!selected || !editName.trim()) return
    setSaving(true); setSaveError(null)
    try {
      if (basicDirty) {
        const res = await fetch(`/api/relationship-types/${selected.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: editName.trim(), nameEn: editNameEn.trim(), description: editDesc,
            labelPairs: validPairs(editPairs), conditions: cleanConditions(editConditions),
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          setSaveError(err.error ?? "保存に失敗しました")
          return
        }
        const updated: RelationshipType = await res.json()
        setRelTypes((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
      }
      if (groupDirty) {
        // 移した先のグループの末尾に置く
        const key = editGroupId ?? UNGROUPED
        const list = sortByOrder(relTypes.filter((r) => groupKeyOf(r) === key && r.id !== selected.id))
        const ok = await applyReorder([{ id: selected.id, order: nextOrder(list), groupId: editGroupId }])
        if (!ok) { setSaveError("タイプグループの変更に失敗しました"); return }
      }
      if (propsDirty) await propertyRef.current?.commit()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "保存に失敗しました")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selected) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/relationship-types/${selected.id}`, { method: "DELETE" })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setSaveError(err.error ?? "削除に失敗しました")
        setShowDelete(false)
        return
      }
      setRelTypes((prev) => prev.filter((r) => r.id !== selected.id))
      setSelectedId(null)
      setShowDelete(false)
    } finally {
      setDeleting(false)
    }
  }

  // ─── 確認（承認） ───
  const targets = useMemo(() => relTypes.filter((r) => checkedIds.has(r.id)), [relTypes, checkedIds])
  const canBulkConfirm = targets.some((r) => deriveConfirmationStatus(r.confirmations).state !== "confirmed")
  const canBulkUnconfirm = targets.some((r) => deriveConfirmationStatus(r.confirmations).state !== "unconfirmed")

  const applyConfirmations = (updated: (RelationshipType | null)[]) => {
    const ok = updated.filter((r): r is RelationshipType => r !== null)
    const byId = new Map(ok.map((r) => [r.id, r]))
    setRelTypes((prev) => prev.map((r) => byId.get(r.id) ?? r))
    setCheckedIds(new Set())
  }

  // 使用中のタイプは消せないので、消せたものだけ一覧から外し、残った理由を出す
  const inUseTargets = useMemo(
    () => targets.filter((t) => (relCounts[t.id] ?? 0) > 0),
    [targets, relCounts],
  )

  const handleBulkDelete = async () => {
    setBulkDeleting(true)
    setBulkDeleteError(null)
    try {
      const results = await Promise.all(
        targets.map((t) =>
          fetch(`/api/relationship-types/${t.id}`, { method: "DELETE" })
            .then((r) => ({ id: t.id, name: t.name, ok: r.ok })),
        ),
      )
      const removed = new Set(results.filter((r) => r.ok).map((r) => r.id))
      const failed = results.filter((r) => !r.ok)
      setRelTypes((prev) => prev.filter((t) => !removed.has(t.id)))
      if (selectedId && removed.has(selectedId)) setSelectedId(null)
      setCheckedIds(new Set())
      if (failed.length > 0) {
        setBulkDeleteError(
          `${failed.length}件は使用中のため削除できませんでした：${failed.map((f) => f.name).join("、")}`,
        )
      } else {
        setShowBulkDelete(false)
      }
      fetchAll()
    } finally {
      setBulkDeleting(false)
    }
  }

  const handleConfirm = async (confirmerName: string) => {
    setConfirming(true)
    try {
      const updated = await Promise.all(
        targets.map((r) =>
          fetch(`/api/relationship-types/${r.id}/confirmations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ confirmerName }),
          }).then((res) => (res.ok ? res.json() : null)),
        ),
      )
      applyConfirmations(updated)
      setShowConfirm(false)
    } finally {
      setConfirming(false)
    }
  }

  const handleUnconfirm = async () => {
    setUnconfirming(true)
    try {
      const updated = await Promise.all(
        targets.map((r) =>
          fetch(`/api/relationship-types/${r.id}/confirmations`, { method: "DELETE" })
            .then((res) => (res.ok ? res.json() : null)),
        ),
      )
      applyConfirmations(updated)
    } finally {
      setUnconfirming(false)
    }
  }

  const typeRows = listRows.filter((r): r is Extract<ListRow, { kind: "relType" }> => r.kind === "relType")

  // ラベルペアが1つも無い／参照先ラベルが消えている
  const incomplete = (r: RelationshipType) =>
    (r.labelPairs ?? []).length === 0 ||
    (r.labelPairs ?? []).some((p) => labelMissing(p.sourceLabelId) || labelMissing(p.targetLabelId))

  const renderPairEditor = (
    pairs: LabelPair[],
    set: (fn: (prev: LabelPair[]) => LabelPair[]) => void,
  ) => (
    <div className="space-y-1.5">
      <FieldLabel className="text-sm font-medium">
        始点(A)・終点(B)ラベルのペア <span className="text-destructive">*</span>
      </FieldLabel>
      <div className="space-y-2">
        {pairs.map((pair, i) => (
          <div key={i} className="flex items-center gap-2">
            <Select value={pair.sourceLabelId || "__none__"}
              onValueChange={(v) => updatePair(set, i, "sourceLabelId", !v || v === "__none__" ? "" : v)}>
              <SelectTrigger className="h-8 min-w-0 flex-1">
                <SelectValue>{pair.sourceLabelId ? labelName(pair.sourceLabelId) : "始点(A)ラベル"}</SelectValue>
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {sortedLabels.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Select value={pair.targetLabelId || "__none__"}
              onValueChange={(v) => updatePair(set, i, "targetLabelId", !v || v === "__none__" ? "" : v)}>
              <SelectTrigger className="h-8 min-w-0 flex-1">
                <SelectValue>{pair.targetLabelId ? labelName(pair.targetLabelId) : "終点(B)ラベル"}</SelectValue>
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {sortedLabels.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {pairs.length > 1 && (
              <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-muted-foreground"
                aria-label="このペアを削除" onClick={() => removePair(set, i)}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
      </div>
      <Button size="sm" variant="outline" className="gap-1 bg-transparent" onClick={() => addPair(set)}>
        <Plus className="h-3.5 w-3.5" />ペアを追加
      </Button>
      <p className="mt-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        ノードが<strong className="font-medium text-foreground">そのラベルを持っていれば</strong>このタイプを使えます。
        上位・下位をまとめたいときは、上位のラベルでペアを宣言し、ノード側に上位ラベルも付けてください。
      </p>
    </div>
  )

  const renderConditionEditor = (
    conditions: ConditionSlot[],
    set: (fn: (prev: ConditionSlot[]) => ConditionSlot[]) => void,
  ) => (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">
        成立に関わる<strong className="font-medium text-foreground">対象データ</strong>をここで挙げます。
        実際の演算子と値は<strong className="font-medium text-foreground">リレーションシップごと</strong>に決めます。
      </p>
      {conditions.length === 0 ? (
        <p className="rounded-md border border-dashed border-border py-2 text-center text-xs text-muted-foreground">
          条件項目なし（常に成立）
        </p>
      ) : (
        <div className="space-y-1.5">
          {conditions.map((c, i) => (
            <div key={c.id} className="flex items-center gap-1.5">
              <Input className="h-8 min-w-0 flex-1" placeholder="対象データ名（例：気温）"
                value={c.variable} onChange={(e) => updateCondition(set, i, { variable: e.target.value })} />
              <Input className="h-8 w-20 shrink-0" placeholder="単位"
                value={c.unit ?? ""} onChange={(e) => updateCondition(set, i, { unit: e.target.value })} />
              <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-muted-foreground"
                aria-label="この条件項目を削除"
                onClick={() => set((prev) => prev.filter((_, idx) => idx !== i))}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <Button size="sm" variant="outline" className="gap-1 bg-transparent"
        onClick={() => set((prev) => [...prev, newConditionSlot()])}>
        <Plus className="h-3.5 w-3.5" />条件項目を追加
      </Button>
    </div>
  )

  return (
    <div className="flex h-full flex-col">
      <TopBar group="スキーマ設計" title="リレーションシップタイプ管理">
        {!loading && currentProject && (
          <span className="text-xs text-muted-foreground">タイプ {relTypes.length}</span>
        )}
      </TopBar>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden border-r border-border">
          <div className="flex items-center justify-between gap-3 px-6 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <h2 className="shrink-0 text-base font-semibold text-foreground">リレーションシップタイプ一覧</h2>
              <ViewToggle value={viewMode} onChange={setViewMode} />
              <button type="button"
                className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
                onClick={() => setShowGroupManager(true)} disabled={!currentProject}>
                グループを管理
              </button>
            </div>
            <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1.5 bg-transparent"
              onClick={openAddDialog} disabled={!currentProject}>
              <Plus className="h-3.5 w-3.5" />タイプを追加
            </Button>
          </div>

          <div className="flex items-center gap-2 px-6 pb-3 text-xs">
            <span className="shrink-0 text-muted-foreground">表示フィルター：</span>
            {([
              { key: "all", label: "全て" },
              { key: "confirmed", label: "確認済み" },
              { key: "confirmed_edited", label: "確認済み*" },
              { key: "unconfirmed", label: "未確認" },
            ] as { key: "all" | ConfirmationState; label: string }[]).map((opt) => (
              <button key={opt.key} type="button"
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-full border px-2.5 py-0.5 transition-colors",
                  filterState === opt.key
                    ? "border-indigo-400 bg-indigo-100 text-indigo-800 dark:border-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
                onClick={() => setFilterState(opt.key)}>
                {opt.label}
              </button>
            ))}
            {!canReorder && viewMode === "list" && (
              <span className="text-muted-foreground">（絞り込み中は並べ替えできません）</span>
            )}
          </div>

          {checkedIds.size > 0 && (canBulkConfirm || canBulkUnconfirm) && (
            <div className="flex items-center gap-2 px-6 pb-3 text-xs">
              <span className="text-muted-foreground">{checkedIds.size}件を：</span>
              {canBulkConfirm && (
                <Button size="sm" variant="outline" className="h-7 gap-1.5 bg-transparent"
                  onClick={() => setShowConfirm(true)}>
                  <CheckCircle2 className="h-3.5 w-3.5" />確認する
                </Button>
              )}
              {canBulkUnconfirm && (
                <Button size="sm" variant="outline" className="h-7 gap-1.5 bg-transparent"
                  onClick={handleUnconfirm} disabled={unconfirming}>
                  {unconfirming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                  確認を取り消す
                </Button>
              )}
              {targets.length > 0 && (
                <Button size="sm" variant="outline"
                  className="h-7 gap-1.5 bg-transparent text-muted-foreground hover:text-destructive"
                  onClick={() => { setBulkDeleteError(null); setShowBulkDelete(true) }}>
                  <Trash2 className="h-3.5 w-3.5" />削除する
                </Button>
              )}
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col px-6 pb-6">
            {loading && relTypes.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : relTypes.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">
                {currentProject ? "リレーションシップタイプが登録されていません" : "プロジェクトを選択してください"}
              </p>
            ) : viewMode === "board" ? (
              <GroupBoard items={boardItems} groups={groups} selectedId={selectedId}
                onSelect={(id) => setSelectedId((prev) => (prev === id ? null : id))}
                onReorder={applyReorder} />
            ) : (
              <ListDndContext
                onDrop={handleRowDrop}
                labelOf={(id) => (
                  <span className="font-medium text-foreground">
                    {relTypes.find((r) => r.id === id)?.name ?? id}
                  </span>
                )}
              >
                <div className="h-full overflow-hidden rounded-lg border border-border">
                  <Table containerClassName="h-full overflow-auto">
                    <TableHeader>
                      {/* 縦スクロールしても見出しは残す */}
                      <TableRow className="bg-muted hover:bg-muted [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:bg-muted">
                        <TableHead className="w-8" />
                        <TableHead className="w-10">
                          <input type="checkbox" aria-label="表示中のタイプをすべて選択"
                            checked={typeRows.length > 0 && typeRows.every((r) => checkedIds.has(r.relType.id))}
                            onChange={(e) => {
                              const next = new Set(checkedIds)
                              if (e.target.checked) typeRows.forEach((r) => next.add(r.relType.id))
                              else typeRows.forEach((r) => next.delete(r.relType.id))
                              setCheckedIds(next)
                            }} />
                        </TableHead>
                        <TableHead className="font-semibold text-foreground">タイプ名</TableHead>
                        <TableHead className="w-20 font-semibold text-foreground">条件有無</TableHead>
                        <TableHead className="w-20 font-semibold text-foreground">利用数</TableHead>
                        <TableHead className="font-semibold text-foreground">ラベルペア</TableHead>
                        <TableHead className="w-32 font-semibold text-foreground">登録確認</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {listRows.map((row) => {
                        if (row.kind === "group") {
                          return (
                            <DropRow key={row.key} id={row.key} enabled={canReorder}
                              className="bg-muted/40 hover:bg-muted/40">
                              <TableCell colSpan={7} className="py-1.5">
                                <button type="button"
                                  aria-label={`${row.name}を${collapsedGroupKeys.has(row.groupKey) ? "開く" : "閉じる"}`}
                                  onClick={() => setCollapsedGroupKeys((prev) => toggleIn(prev, row.groupKey))}
                                  className="flex items-center gap-2 text-xs font-semibold text-foreground">
                                  {collapsedGroupKeys.has(row.groupKey)
                                    ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                    : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                                  <span className="h-2.5 w-2.5 rounded-full border border-border"
                                    style={row.color ? { backgroundColor: row.color } : undefined} />
                                  <span className="font-normal text-muted-foreground">タイプグループ：</span>
                                  {row.name}
                                  <span className="font-normal text-muted-foreground">{row.count}件</span>
                                </button>
                              </TableCell>
                            </DropRow>
                          )
                        }
                        const r = row.relType
                        const status = deriveConfirmationStatus(r.confirmations)
                        const pairs = r.labelPairs ?? []
                        return (
                          <DragRow key={row.key} id={r.id} label={r.name} enabled={canReorder}
                            className={cn(
                              "cursor-pointer transition-colors",
                              selectedId === r.id
                                ? "bg-indigo-100 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-950/50"
                                : "hover:bg-muted/50",
                            )}
                            onClick={() => setSelectedId(r.id)}>
                            <TableCell className="align-top" onClick={(e) => e.stopPropagation()}>
                              <input type="checkbox" aria-label={`${r.name}を選択`}
                                checked={checkedIds.has(r.id)}
                                onChange={() => setCheckedIds((prev) => toggleIn(prev, r.id))} />
                            </TableCell>
                            <TableCell className="align-top">
                              <span className="flex items-center gap-1 font-medium text-foreground">
                                <span className="truncate" title={r.name}>{r.name}</span>
                                {incomplete(r) && (
                                  <Tooltip content="ラベルペアが未設定か、参照先のラベルが見つかりません">
                                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
                                  </Tooltip>
                                )}
                              </span>
                              {r.nameEn && <span className="block truncate text-xs text-muted-foreground">{r.nameEn}</span>}
                            </TableCell>
                            <TableCell className="align-top text-sm text-foreground">
                              {(r.conditions ?? []).length > 0 ? "あり" : null}
                            </TableCell>
                            <TableCell className="align-top text-sm text-muted-foreground">
                              {relCounts[r.id] ?? 0}
                            </TableCell>
                            <TableCell className="align-top text-sm text-muted-foreground">
                              {pairs.length > 0 ? (
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                  {pairs.slice(0, 3).map((p, i) => (
                                    <span key={i} className="inline-flex items-center gap-1 whitespace-nowrap">
                                      <LabelChip name={labelName(p.sourceLabelId)}
                                        className={cn(labelMissing(p.sourceLabelId) && "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200")} />
                                      <ArrowRight className="h-3 w-3 shrink-0" />
                                      <LabelChip name={labelName(p.targetLabelId)}
                                        className={cn(labelMissing(p.targetLabelId) && "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200")} />
                                    </span>
                                  ))}
                                  {pairs.length > 3 && (
                                    <span className="whitespace-nowrap text-xs">＋他{pairs.length - 3}件（詳細で確認）</span>
                                  )}
                                </div>
                              ) : "—"}
                            </TableCell>
                            <TableCell className="align-top">
                              <ConfirmationBadge state={status.state} latestConfirm={status.latestConfirm} />
                            </TableCell>
                          </DragRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              </ListDndContext>
            )}
          </div>
        </div>

        {selected && (
          <div className="flex w-[30rem] shrink-0 flex-col overflow-hidden bg-card">
            <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
              <section className="space-y-3">
                <SectionHeader icon={FileText} title="基本情報" />
                <div className="space-y-3">
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <ConfirmationSummary events={selected.confirmations} fieldLabels={REL_TYPE_FIELD_LABEL} />
                    <p>登録日 {formatDateTime(selected.createdAt)}{selected.createdBy ? `（${selected.createdBy}）` : ""}</p>
                    <p>更新日 {formatDateTime(selected.updatedAt)}{selected.updatedBy ? `（${selected.updatedBy}）` : ""}</p>
                    <p>このタイプを使っているリレーションシップ {relCounts[selected.id] ?? 0}件</p>
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel className="text-sm font-medium">
                      タイプ名（日本語名） <span className="text-destructive">*</span>
                    </FieldLabel>
                    <Input value={editName} onChange={(e) => setEditName(e.target.value)}
                      className="h-8" placeholder="例：引き起こす" />
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel className="text-sm font-medium">タイプ名（英語名）</FieldLabel>
                    <Input value={editNameEn} onChange={(e) => setEditNameEn(e.target.value)}
                      className="h-8" placeholder="例：causes" />
                  </div>
                  {renderPairEditor(editPairs, setEditPairs)}
                  <div className="space-y-1.5">
                    <FieldLabel className="text-sm font-medium">説明</FieldLabel>
                    <Textarea rows={4} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel className="text-sm font-medium">タイプグループ</FieldLabel>
                    <Select value={editGroupId ?? "__none__"}
                      onValueChange={(v) => setEditGroupId(!v || v === "__none__" ? null : v)}>
                      <SelectTrigger className="h-8">
                        <SelectValue>{groups.find((g) => g.id === editGroupId)?.name ?? "未分類"}</SelectValue>
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        <SelectItem value="__none__">未分類</SelectItem>
                        {groups.map((g) => (
                          <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      一覧を見やすくするための整理用の区分です。スキーマの意味やエクスポートには影響しません。
                    </p>
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <SectionHeader icon={Filter} title="成立条件" />
                {renderConditionEditor(editConditions, setEditConditions)}
              </section>

              <section className="space-y-3">
                <SectionHeader icon={Tags} title="プロパティ" />
                {projectId && (
                  <PropertySection
                    key={selected.id}
                    ref={propertyRef}
                    projectId={projectId}
                    targetType="relationshipType"
                    targetId={selected.id}
                    onDirtyChange={setPropsDirty}
                    note="このタイプのリレーションシップが持てるプロパティです。"
                  />
                )}
              </section>
            </div>

            {saveError && (
              <p className="border-t border-border px-4 pt-2 text-xs text-destructive">{saveError}</p>
            )}
            <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-destructive"
                onClick={() => setShowDelete(true)}>
                <Trash2 className="h-3.5 w-3.5" />削除
              </Button>
              <div className="flex items-center gap-2">
                {dirty && <span className="text-xs text-amber-600 dark:text-amber-500">未保存の変更があります</span>}
                <Button size="sm" className="gap-1.5" onClick={handleSave}
                  disabled={!dirty || saving || !editName.trim() || validPairs(editPairs).length === 0}>
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}保存
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* タイプ追加 */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>リレーションシップタイプを追加</DialogTitle></DialogHeader>
          <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            <div className="space-y-1.5">
              <FieldLabel className="text-sm font-medium">
                タイプ名（日本語名） <span className="text-destructive">*</span>
              </FieldLabel>
              <Input ref={newNameRef} value={newName} onChange={(e) => setNewName(e.target.value)}
                className="h-8" placeholder="例：引き起こす" autoFocus />
            </div>
            <div className="space-y-1.5">
              <FieldLabel className="text-sm font-medium">タイプ名（英語名）</FieldLabel>
              <Input value={newNameEn} onChange={(e) => setNewNameEn(e.target.value)}
                className="h-8" placeholder="例：causes" />
            </div>
            {renderPairEditor(newPairs, setNewPairs)}
            <div className="space-y-1.5">
              <FieldLabel className="text-sm font-medium">説明</FieldLabel>
              <Textarea rows={3} value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <FieldLabel className="text-sm font-medium">タイプグループ</FieldLabel>
              <Select value={newGroupId ?? "__none__"}
                onValueChange={(v) => setNewGroupId(!v || v === "__none__" ? null : v)}>
                <SelectTrigger className="h-8">
                  <SelectValue>
                    {groups.find((g) => g.id === newGroupId)?.name ?? "未分類"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="__none__">未分類</SelectItem>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <FieldLabel className="text-sm font-medium">成立条件</FieldLabel>
              {renderConditionEditor(newConditions, setNewConditions)}
            </div>
            {addError && <p className="text-xs text-destructive">{addError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>キャンセル</Button>
            <Button onClick={handleAdd}
              disabled={adding || !newName.trim() || validPairs(newPairs).length === 0}>
              {adding && <Loader2 className="h-3.5 w-3.5 animate-spin" />}追加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 削除確認 */}
      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>リレーションシップタイプを削除</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            {(relCounts[selected?.id ?? ""] ?? 0) > 0 ? (
              <p className="text-destructive">
                「{selected?.name}」を使っているリレーションシップが {relCounts[selected?.id ?? ""]}件あります。
                先にそちらを削除してください。
              </p>
            ) : (
              <p>
                「{selected?.name}」を削除します。この操作は取り消せません。
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)} disabled={deleting}>キャンセル</Button>
            <Button variant="destructive" onClick={handleDelete}
              disabled={deleting || (relCounts[selected?.id ?? ""] ?? 0) > 0}>
              {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}削除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* まとめて削除 */}
      <Dialog open={showBulkDelete} onOpenChange={setShowBulkDelete}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>リレーションシップタイプをまとめて削除</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            <p>{targets.length}件のタイプを削除します。この操作は取り消せません。</p>
            <p className="max-h-32 overflow-y-auto text-xs text-muted-foreground">
              {targets.map((t) => t.name).join("、")}
            </p>
            {inUseTargets.length > 0 && (
              <p className="text-amber-600 dark:text-amber-500">
                このうち {inUseTargets.length}件は使われているリレーションシップがあるため削除できません。
                先にそちらを削除してください。
              </p>
            )}
            {bulkDeleteError && <p className="text-xs text-destructive">{bulkDeleteError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkDelete(false)} disabled={bulkDeleting}>
              閉じる
            </Button>
            <Button variant="destructive" onClick={handleBulkDelete}
              disabled={bulkDeleting || targets.length === inUseTargets.length}>
              {bulkDeleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}削除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={showConfirm} onOpenChange={setShowConfirm}
        title="リレーションシップタイプを確認"
        description={`${checkedIds.size}件のタイプに確認レコードを追加します。`}
        submitting={confirming} onSubmit={handleConfirm} />

      {currentProject && (
        <GroupManagerDialog open={showGroupManager} onOpenChange={setShowGroupManager}
          projectId={currentProject.id} target="relation" groups={groups} onSaved={setGroups} />
      )}
    </div>
  )
}
