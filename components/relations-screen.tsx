"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { TopBar } from "@/components/top-bar"
import { Tooltip } from "@/components/ui/tooltip"
import { ImportDialog } from "@/components/import-dialog"
import { SectionHeader } from "@/components/section-header"
import { GroupManagerDialog, useGroups } from "@/components/group-manager"
import { GroupBoard, ViewToggle, type BoardViewMode, type ReorderUpdate } from "@/components/group-board"
import { cn } from "@/lib/utils"
import { ORDER_STEP, UNGROUPED, renumber, sortByOrder, sortGroups } from "@/lib/organize"
import type { OntologyRelation, OntologyClass, OntologyAttribute, OntologyGroup, AttributeRequired, ClassPair, RelationCondition, RelationConditionOperator } from "@/lib/types"
import {
  buildRelationsYaml,
  downloadYaml,
  parseRelationsYaml,
  previewRelationsImport,
  executeRelationsImport,
  type RelationExportItem,
} from "@/lib/import-export"
import { ArrowDown, ArrowRight, ArrowUp, Plus, Pencil, Trash2, Loader2, X, AlertTriangle, Info, Download, Upload, FileText, Tags, CheckCircle2, Filter } from "lucide-react"
import { useProject } from "@/app/project-context"
import { deriveConfirmationStatus, type ConfirmationState } from "@/lib/confirmation"
import { hasConditions } from "@/lib/relation-conditions"
import { ConfirmationBadge } from "@/components/confirmation-badge"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { ConfirmationSummary } from "@/components/confirmation-summary"

type AttrSectionKey = "project" | "own"

const RELATION_FIELD_LABEL: Record<string, string> = {
  name: "リレーション名",
  nameEn: "英語名",
  description: "説明",
  classPairs: "始点(A)/終点(B)",
  parentRelationId: "上位リレーション",
  conditions: "成立条件",
  attributes: "属性",
}

// 成立条件の演算子カタログ（表示ラベル・略記号・分類）
const CONDITION_OPERATORS: { value: RelationConditionOperator; symbol: string; label: string; group: "比較" | "範囲" | "集合" }[] = [
  { value: "eq", symbol: "＝", label: "に等しい", group: "比較" },
  { value: "ne", symbol: "≠", label: "に等しくない", group: "比較" },
  { value: "gte", symbol: "≥", label: "以上", group: "比較" },
  { value: "gt", symbol: "＞", label: "より大きい", group: "比較" },
  { value: "lte", symbol: "≤", label: "以下", group: "比較" },
  { value: "lt", symbol: "＜", label: "より小さい", group: "比較" },
  { value: "between", symbol: "範囲内", label: "下限〜上限（両端含む）", group: "範囲" },
  { value: "notBetween", symbol: "範囲外", label: "下限〜上限（両端含む）", group: "範囲" },
  { value: "in", symbol: "IN", label: "いずれかに一致", group: "集合" },
  { value: "notIn", symbol: "NOT IN", label: "いずれにも一致しない", group: "集合" },
]

const isRangeOperator = (op: RelationConditionOperator) => op === "between" || op === "notBetween"
const isSetOperator = (op: RelationConditionOperator) => op === "in" || op === "notIn"
const isScalarOperator = (op: RelationConditionOperator) => !isRangeOperator(op) && !isSetOperator(op)

// 集合演算子の入力欄（カンマ区切り）↔ values 配列
const parseValues = (text: string): string[] =>
  text.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
const formatValues = (vs: string[] | undefined) => (vs ?? []).join(", ")

// 新規条件のデフォルト
const newDefaultCondition = (): RelationCondition => ({
  variable: "",
  operator: "gte",
  value: "",
})

function formatDateTime(iso: string | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
}

export function RelationsScreen({ initialSelectedId, active }: { initialSelectedId?: string; active?: boolean }) {
  const { currentProject, loading: projectLoading } = useProject()
  const [relations, setRelations] = useState<OntologyRelation[]>([])
  const [classes, setClasses] = useState<OntologyClass[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // リレーション追加ダイアログ
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState("")
  const [newNameEn, setNewNameEn] = useState("")
  const [newDesc, setNewDesc] = useState("")
  const [newPairs, setNewPairs] = useState<ClassPair[]>([{ sourceClassId: "", targetClassId: "" }])
  const [newIncludeChildren, setNewIncludeChildren] = useState(true)
  const [newConditions, setNewConditions] = useState<RelationCondition[]>([])
  const [editIncludeChildren, setEditIncludeChildren] = useState(true)
  const [adding, setAdding] = useState(false)

  // 編集モード
  const [editName, setEditName] = useState("")
  const [editNameEn, setEditNameEn] = useState("")
  const [editDesc, setEditDesc] = useState("")
  const [editPairs, setEditPairs] = useState<ClassPair[]>([])
  const [editConditions, setEditConditions] = useState<RelationCondition[]>([])
  const [saving, setSaving] = useState(false)

  // 削除確認ダイアログ
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // 属性
  const [projectAttrs, setProjectAttrs] = useState<OntologyAttribute[]>([])
  const [ownAttrs, setOwnAttrs] = useState<OntologyAttribute[]>([])
  const [loadingAttrs, setLoadingAttrs] = useState(false)

  // 属性追加ダイアログ
  const [showAddAttr, setShowAddAttr] = useState(false)
  const [addAttrSection, setAddAttrSection] = useState<AttrSectionKey>("own")
  const [attrName, setAttrName] = useState("")
  const [attrDesc, setAttrDesc] = useState("")
  const [attrDataType, setAttrDataType] = useState("文字列")
  const [attrRequired, setAttrRequired] = useState<AttributeRequired>("任意")
  const [addingAttr, setAddingAttr] = useState(false)

  // 属性編集ダイアログ
  const [showEditAttr, setShowEditAttr] = useState(false)
  const [editingAttr, setEditingAttr] = useState<OntologyAttribute | null>(null)
  const [editAttrSection, setEditAttrSection] = useState<AttrSectionKey>("own")
  const [editAttrName, setEditAttrName] = useState("")
  const [editAttrDesc, setEditAttrDesc] = useState("")
  const [editAttrDataType, setEditAttrDataType] = useState("文字列")
  const [editAttrRequired, setEditAttrRequired] = useState<AttributeRequired>("任意")
  const [savingAttr, setSavingAttr] = useState(false)

  // インポート/エクスポート
  const [showImport, setShowImport] = useState(false)
  const [exporting, setExporting] = useState(false)

  // 属性削除確認
  const [showAttrAlert, setShowAttrAlert] = useState(false)
  const [attrAlertMsg, setAttrAlertMsg] = useState("")
  const [attrAlertIsWarning, setAttrAlertIsWarning] = useState(false)
  const [pendingAttrAction, setPendingAttrAction] = useState<{ fn: () => Promise<void> } | null>(null)

  // 確認機構
  // 整理用グループ（クラス管理と同じ一覧を共用する）
  const { groups, setGroups, refresh: refreshGroups } = useGroups(currentProject?.id, "relation")
  const [viewMode, setViewMode] = useState<BoardViewMode>("list")
  const [showGroupManager, setShowGroupManager] = useState(false)
  const [movingGroup, setMovingGroup] = useState(false)

  // ボード表示へ切り替えた時点で選択を外す。整理中は基本情報ペインを出さず全幅で扱う。
  const changeViewMode = (mode: BoardViewMode) => {
    setViewMode(mode)
    if (mode === "board") setSelectedId(null)
  }

  const [filterState, setFilterState] = useState<"all" | ConfirmationState>("all")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showBulkConfirm, setShowBulkConfirm] = useState(false)
  const [bulkConfirming, setBulkConfirming] = useState(false)
  const [bulkUnconfirming, setBulkUnconfirming] = useState(false)

  const fetchRelations = useCallback(async () => {
    if (!currentProject) return
    setLoading(true)
    try {
      const data: OntologyRelation[] = await fetch(
        `/api/relations?projectId=${currentProject.id}`
      ).then((r) => r.json())
      setRelations(Array.isArray(data) ? data : [])
    } finally {
      setLoading(false)
    }
  }, [currentProject?.id])

  const fetchClasses = useCallback(async () => {
    if (!currentProject) return
    const data: OntologyClass[] = await fetch(
      `/api/classes?projectId=${currentProject.id}`
    ).then((r) => r.json())
    setClasses(Array.isArray(data) ? data : [])
  }, [currentProject?.id])

  // プロジェクト切替時のみデータを捨てる。取得は下の表示時 effect に任せる。
  useEffect(() => {
    if (projectLoading) return
    setSelectedId(null)
    setRelations([])
    setClasses([])
    setLoading(!!currentProject)
  }, [currentProject?.id, projectLoading])

  useEffect(() => {
    if (initialSelectedId && relations.length > 0) {
      setSelectedId(initialSelectedId)
    }
  }, [initialSelectedId, relations.length])

  // この画面が表示状態になったら再取得する（画面はマウント維持されるため、
  // 文書取込みでリレーションを本登録した結果などを反映するのに必要）
  useEffect(() => {
    if (active && currentProject) {
      fetchRelations()
      fetchClasses()
      refreshGroups()
    }
  }, [active, currentProject?.id, fetchRelations, fetchClasses, refreshGroups])

  const fetchAllAttrs = useCallback(async (relationId: string, projectId: string) => {
    setLoadingAttrs(true)
    try {
      const [projData, ownData] = await Promise.all([
        fetch(`/api/attributes?targetId=${projectId}`).then((r) => r.json()),
        fetch(`/api/attributes?targetId=${relationId}`).then((r) => r.json()),
      ])
      setProjectAttrs(Array.isArray(projData) ? projData : [])
      setOwnAttrs(Array.isArray(ownData) ? ownData : [])
    } finally {
      setLoadingAttrs(false)
    }
  }, [])

  useEffect(() => {
    if (!selectedId || !currentProject) {
      setProjectAttrs([]); setOwnAttrs([])
      return
    }
    // 常時編集可のため、選択のたびに編集フィールドを対象リレーションで初期化する
    const rel = relations.find((r) => r.id === selectedId)
    if (rel) {
      setEditName(rel.name)
      setEditNameEn(rel.nameEn ?? "")
      setEditDesc(rel.description ?? "")
      setEditPairs(rel.classPairs ?? [])
      setEditConditions(rel.conditions ?? [])
      setEditIncludeChildren(true)
    }
    fetchAllAttrs(selectedId, currentProject.id)
  }, [selectedId, currentProject?.id])

  const handleAdd = async () => {
    if (!newName.trim() || !currentProject || newPairs.length === 0 || newPairs.some(p => !p.sourceClassId || !p.targetClassId)) return
    if (!conditionsValid(newConditions)) return
    setAdding(true)
    try {
      const res = await fetch("/api/relations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: currentProject.id,
          name: newName.trim(),
          nameEn: newNameEn.trim(),
          description: newDesc.trim(),
          classPairs: newIncludeChildren ? expandPairs(newPairs) : newPairs,
          conditions: normalizeConditions(newConditions),
        }),
      })
      if (!res.ok) return
      // 一覧は全件を取り直さず、作成結果を足すだけにする
      const created: OntologyRelation = await res.json()
      setRelations((prev) => [...prev, created])
      setSelectedId(created.id)
      setShowAdd(false)
      setNewName(""); setNewNameEn(""); setNewDesc(""); setNewPairs([{ sourceClassId: "", targetClassId: "" }]); setNewConditions([])
    } finally {
      setAdding(false)
    }
  }

  const addNewPair = () => setNewPairs(p => [...p, { sourceClassId: "", targetClassId: "" }])
  const removeNewPair = (i: number) => setNewPairs(p => p.filter((_, j) => j !== i))
  const updateNewPair = (i: number, field: keyof ClassPair, val: string) =>
    setNewPairs(p => p.map((pair, j) => j === i ? { ...pair, [field]: val } : pair))

  const addEditPair = () => setEditPairs(p => [...p, { sourceClassId: "", targetClassId: "" }])
  const removeEditPair = (i: number) => setEditPairs(p => p.filter((_, j) => j !== i))
  const updateEditPair = (i: number, field: keyof ClassPair, val: string) =>
    setEditPairs(p => p.map((pair, j) => j === i ? { ...pair, [field]: val } : pair))

  const handleSave = async () => {
    if (!editName.trim() || !selected || editPairs.length === 0 || editPairs.some(p => !p.sourceClassId || !p.targetClassId)) return
    if (!conditionsValid(editConditions)) return
    setSaving(true)
    try {
      await fetch(`/api/relations/${selected.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          nameEn: editNameEn.trim(),
          description: editDesc.trim(),
          classPairs: editIncludeChildren ? expandPairs(editPairs) : editPairs,
          conditions: normalizeConditions(editConditions),
        }),
      })
      await fetchRelations()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selected) return
    setDeleting(true)
    try {
      await fetch(`/api/relations/${selected.id}`, { method: "DELETE" })
      await fetchRelations()
      setSelectedId(null)
      setShowDelete(false)
    } finally {
      setDeleting(false)
    }
  }

  const openAddAttr = (section: AttrSectionKey) => {
    setAddAttrSection(section)
    setAttrName(""); setAttrDesc(""); setAttrDataType("文字列"); setAttrRequired("任意")
    setShowAddAttr(true)
  }

  const handleAddAttr = async () => {
    if (!attrName.trim() || !selected || !currentProject) return
    setAddingAttr(true)
    try {
      const isProject = addAttrSection === "project"
      await fetch("/api/attributes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: currentProject.id,
          name: attrName.trim(),
          description: attrDesc.trim(),
          dataType: attrDataType,
          required: attrRequired,
          scope: isProject ? "共通" : "固有",
          targetId: isProject ? currentProject.id : selected.id,
          targetType: isProject ? "project" : "relation",
        }),
      })
      await fetchAllAttrs(selected.id, currentProject.id)
      setShowAddAttr(false)
      setAttrName(""); setAttrDesc(""); setAttrDataType("文字列"); setAttrRequired("任意")
    } finally {
      setAddingAttr(false)
    }
  }

  const openEditAttr = (attr: OntologyAttribute, section: AttrSectionKey) => {
    setEditingAttr(attr)
    setEditAttrSection(section)
    setEditAttrName(attr.name)
    setEditAttrDesc(attr.description ?? "")
    setEditAttrDataType(attr.dataType)
    setEditAttrRequired(attr.required)
    setShowEditAttr(true)
  }

  const handleEditAttr = async () => {
    if (!editingAttr || !editAttrName.trim() || !selected || !currentProject) return
    setSavingAttr(true)
    try {
      await fetch(`/api/attributes/${editingAttr.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editAttrName.trim(),
          description: editAttrDesc.trim(),
          dataType: editAttrDataType,
          required: editAttrRequired,
        }),
      })
      await fetchAllAttrs(selected.id, currentProject.id)
      setShowEditAttr(false)
      setEditingAttr(null)
    } finally {
      setSavingAttr(false)
    }
  }

  const handleDeleteAttr = (attr: OntologyAttribute, section: AttrSectionKey) => {
    const doDelete = async () => {
      await fetch(`/api/attributes/${attr.id}`, { method: "DELETE" })
      if (selected && currentProject) {
        await fetchAllAttrs(selected.id, currentProject.id)
      }
    }
    const isWarning = section === "project"
    const msg = isWarning
      ? `「${attr.name}」はプロジェクト全体の共通属性です。削除するとすべてのクラス・リレーションから除去されます。`
      : `「${attr.name}」を削除します。この操作は取り消せません。`
    setAttrAlertMsg(msg)
    setAttrAlertIsWarning(isWarning)
    setPendingAttrAction({ fn: doDelete })
    setShowAttrAlert(true)
  }

  const handleExport = async () => {
    if (!currentProject || relations.length === 0) return
    setExporting(true)
    try {
      const attrsByRelationId = new Map<string, OntologyAttribute[]>()
      await Promise.all(relations.map(async (r) => {
        const attrs = await fetch(`/api/attributes?targetId=${r.id}`).then((res) => res.json())
        attrsByRelationId.set(r.id, Array.isArray(attrs) ? attrs : [])
      }))
      const classesById = new Map(classes.map((c) => [c.id, c]))
      const yamlText = buildRelationsYaml(relations, classesById, attrsByRelationId)
      downloadYaml(`relations_${currentProject.name}.yaml`, yamlText)
    } finally {
      setExporting(false)
    }
  }

  // 初回訪問（未選択）時は先頭のリレーションを自動選択する。再訪問時は前回の選択を維持する
  useEffect(() => {
    if (loading || selectedId || relations.length === 0) return
    // ボード表示は非選択のまま（全幅）で始める
    if (viewMode === "board") return
    setSelectedId(relations[0].id)
  }, [loading, selectedId, relations.length, viewMode])

  const selected = relations.find((r) => r.id === selectedId)

  // 表示中のリレーション（確認状態フィルタ）
  const displayedRelations = useMemo(
    () =>
      filterState === "all"
        ? relations
        : relations.filter((r) => deriveConfirmationStatus(r.confirmations).state === filterState),
    [relations, filterState],
  )

  const selectedGroup = groups.find((g) => g.id === (selected?.groupId ?? "")) ?? null

  // 並べ替えは全件表示のときだけ。絞り込み中は隠れた行と入れ替わって挙動が読めなくなる。
  const canReorder = filterState === "all"

  type ListRow =
    | { kind: "group"; key: string; group: OntologyGroup | null; count: number }
    // siblingIds / index は↑↓での入れ替えに使う（同じグループの並びの中だけで動かす）
    | { kind: "relation"; key: string; rel: OntologyRelation; siblingIds: string[]; index: number }

  // グループごとに仕分けして並べる。グループが未作成のうちは見出しを出さない。
  const listRows: ListRow[] = useMemo(() => {
    if (groups.length === 0) {
      const ordered = sortByOrder(displayedRelations)
      const siblingIds = ordered.map((r) => r.id)
      return ordered.map((rel, index) => ({ kind: "relation" as const, key: rel.id, rel, siblingIds, index }))
    }
    const known = new Set(groups.map((g) => g.id))
    const buckets = new Map<string, OntologyRelation[]>()
    for (const r of displayedRelations) {
      const key = r.groupId && known.has(r.groupId) ? r.groupId : UNGROUPED
      const list = buckets.get(key)
      if (list) list.push(r)
      else buckets.set(key, [r])
    }
    const sections: { group: OntologyGroup | null; items: OntologyRelation[] }[] = sortGroups(groups).map((g) => ({
      group: g,
      items: sortByOrder(buckets.get(g.id) ?? []),
    }))
    sections.push({ group: null, items: sortByOrder(buckets.get(UNGROUPED) ?? []) })
    return sections.flatMap((section) => {
      if (!section.group && section.items.length === 0) return []
      const siblingIds = section.items.map((r) => r.id)
      return [
        {
          kind: "group" as const,
          key: `group:${section.group?.id ?? "ungrouped"}`,
          group: section.group,
          count: section.items.length,
        },
        ...section.items.map((rel, index) => ({ kind: "relation" as const, key: rel.id, rel, siblingIds, index })),
      ]
    })
  }, [displayedRelations, groups])

  // ボード上のドラッグ結果を保存する。groupId と order だけを動かす。
  const applyReorder = async (updates: ReorderUpdate[]): Promise<boolean> => {
    if (!currentProject) return false
    const byId = new Map(updates.map((u) => [u.id, u]))
    const before = relations
    setRelations((prev) =>
      prev.map((r) => {
        const u = byId.get(r.id)
        return u ? { ...r, groupId: u.groupId, order: u.order } : r
      }),
    )
    try {
      const res = await fetch("/api/relations/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: currentProject.id, updates }),
      })
      if (!res.ok) { setRelations(before); return false }
      return true
    } catch {
      setRelations(before)
      return false
    }
  }

  // 並び順だけの更新（groupId は送らず、サーバ側で現状のまま据え置く）
  const applyOrderOnly = async (updates: { id: string; order: number }[]) => {
    if (!currentProject || updates.length === 0) return
    const orderById = new Map(updates.map((u) => [u.id, u.order]))
    const before = relations
    setMovingGroup(true)
    setRelations((prev) =>
      prev.map((r) => {
        const order = orderById.get(r.id)
        return order === undefined ? r : { ...r, order }
      }),
    )
    try {
      const res = await fetch("/api/relations/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: currentProject.id, updates }),
      })
      if (!res.ok) setRelations(before)
    } catch {
      setRelations(before)
    } finally {
      setMovingGroup(false)
    }
  }

  // 一覧での順序変更。同じグループの並びの中だけで入れ替える。
  const moveRelation = (siblingIds: string[], index: number, delta: number) => {
    const to = index + delta
    if (to < 0 || to >= siblingIds.length) return
    const ids = [...siblingIds]
    const [moved] = ids.splice(index, 1)
    ids.splice(to, 0, moved)
    applyOrderOnly(ids.map((id, i) => ({ id, order: (i + 1) * ORDER_STEP })))
  }

  // 所属グループの変更。移動先グループの末尾に置く。
  // 既存データは order 未設定（＝末尾）なので、この機会に移動先だけ 1000 刻みで振り直す。
  // 整理の都合なので確認履歴にも更新日時にも手を付けない（サーバ側も同じ方針）。
  const handleChangeGroup = async (relationId: string, groupId: string | null) => {
    const moved = relations.find((r) => r.id === relationId)
    if (!currentProject || !moved) return
    const ordered = [
      ...sortByOrder(relations.filter((r) => r.id !== relationId && (r.groupId ?? null) === groupId)),
      moved,
    ]
    const updates = renumber(ordered).map((u) => (u.id === relationId ? { ...u, groupId } : u))
    const orderById = new Map(updates.map((u) => [u.id, u.order]))
    const before = relations
    setMovingGroup(true)
    setRelations((prev) =>
      prev.map((r) => {
        const order = orderById.get(r.id)
        if (order === undefined) return r
        return r.id === relationId ? { ...r, groupId, order } : { ...r, order }
      }),
    )
    try {
      const res = await fetch("/api/relations/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: currentProject.id, updates }),
      })
      if (!res.ok) setRelations(before)
    } catch {
      setRelations(before)
    } finally {
      setMovingGroup(false)
    }
  }

  const selectedStates = Array.from(selectedIds).map((id) => {
    const r = relations.find((rr) => rr.id === id)
    return deriveConfirmationStatus(r?.confirmations).state
  })
  const canBulkConfirm = selectedStates.some((s) => s === "unconfirmed" || s === "confirmed_edited")
  const canBulkUnconfirm = selectedStates.some((s) => s === "confirmed" || s === "confirmed_edited")

  const handleBulkConfirm = async (confirmerName: string) => {
    const targets = Array.from(selectedIds).filter((id) => {
      const r = relations.find((rr) => rr.id === id)
      const s = deriveConfirmationStatus(r?.confirmations).state
      return s === "unconfirmed" || s === "confirmed_edited"
    })
    if (targets.length === 0) return
    setBulkConfirming(true)
    try {
      await Promise.all(
        targets.map((id) =>
          fetch(`/api/relations/${id}/confirmations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ confirmerName }),
          })
        )
      )
      await fetchRelations()
      setSelectedIds(new Set())
      setShowBulkConfirm(false)
    } finally {
      setBulkConfirming(false)
    }
  }

  const handleBulkUnconfirm = async () => {
    const targets = Array.from(selectedIds).filter((id) => {
      const r = relations.find((rr) => rr.id === id)
      const s = deriveConfirmationStatus(r?.confirmations).state
      return s === "confirmed" || s === "confirmed_edited"
    })
    if (targets.length === 0) return
    setBulkUnconfirming(true)
    try {
      await Promise.all(
        targets.map((id) => fetch(`/api/relations/${id}/confirmations`, { method: "DELETE" }))
      )
      await fetchRelations()
      setSelectedIds(new Set())
    } finally {
      setBulkUnconfirming(false)
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const className = (id: string | null) => id ? (classes.find((c) => c.id === id)?.name ?? "不明") : "—"
  // 参照先クラスが削除された（存在しない）／未設定の端点を「不明」とみなす
  const classMissing = (id: string | null | undefined) => !id || !classes.some((c) => c.id === id)

  // クラス階層：ある親クラスの子孫クラスidを再帰列挙。
  const hasChildren = (classId: string) => classes.some((c) => c.parentId === classId)
  const descendantIds = (classId: string): string[] => {
    const out: string[] = []
    const stack = classes.filter((c) => c.parentId === classId).map((c) => c.id)
    while (stack.length) {
      const id = stack.pop()!
      out.push(id)
      for (const c of classes) if (c.parentId === id) stack.push(c.id)
    }
    return out
  }
  // 親クラスを指定したペアを、その子孫クラスを含む全組合せに展開（重複除去）。
  const expandPairs = (pairs: ClassPair[]): ClassPair[] => {
    const seen = new Set<string>()
    const out: ClassPair[] = []
    for (const p of pairs) {
      if (!p.sourceClassId || !p.targetClassId) continue
      const sources = [p.sourceClassId, ...descendantIds(p.sourceClassId)]
      const targets = [p.targetClassId, ...descendantIds(p.targetClassId)]
      for (const s of sources)
        for (const t of targets) {
          const k = `${s}|${t}`
          if (!seen.has(k)) { seen.add(k); out.push({ sourceClassId: s, targetClassId: t }) }
        }
    }
    return out
  }
  // ペア群に子クラスを持つ親クラスが含まれるか（子クラス取り込みオプションの表示判定）
  const pairsHaveParent = (pairs: ClassPair[]) =>
    pairs.some((p) => (p.sourceClassId && hasChildren(p.sourceClassId)) || (p.targetClassId && hasChildren(p.targetClassId)))
  // classPairs のいずれかの端点が不明なら、定義が不完全なリレーション
  const relationIncomplete = (r: OntologyRelation) =>
    (r.classPairs ?? []).length === 0 ||
    (r.classPairs ?? []).some((p) => classMissing(p.sourceClassId) || classMissing(p.targetClassId))

  // 成立条件の妥当性判定：対象データ名は必須、演算子ごとに必要な値欄が埋まっている必要がある
  const conditionsValid = (list: RelationCondition[]): boolean =>
    list.every((c) => {
      if (!c.variable || !c.variable.trim()) return false
      if (isRangeOperator(c.operator)) {
        return (c.valueMin ?? "").trim() !== "" && (c.valueMax ?? "").trim() !== ""
      }
      if (isSetOperator(c.operator)) {
        return (c.values ?? []).length > 0
      }
      return (c.value ?? "").trim() !== ""
    })

  // 保存前に条件を正規化（trim・不要フィールド除去）
  const normalizeConditions = (list: RelationCondition[]): RelationCondition[] =>
    list.map((c) => {
      const base: RelationCondition = {
        variable: c.variable.trim(),
        operator: c.operator,
      }
      const unit = (c.unit ?? "").trim()
      if (unit) base.unit = unit
      if (isRangeOperator(c.operator)) {
        base.valueMin = (c.valueMin ?? "").trim()
        base.valueMax = (c.valueMax ?? "").trim()
      } else if (isSetOperator(c.operator)) {
        base.values = (c.values ?? []).map((v) => v.trim()).filter((v) => v.length > 0)
      } else {
        base.value = (c.value ?? "").trim()
      }
      return base
    })

  // 条件行の更新ヘルパー
  const updateCondition = (
    setter: (updater: (prev: RelationCondition[]) => RelationCondition[]) => void,
    index: number,
    patch: Partial<RelationCondition>,
  ) => {
    setter((prev) => prev.map((c, i) => {
      if (i !== index) return c
      const merged: RelationCondition = { ...c, ...patch }
      const nextOp = patch.operator ?? c.operator
      // 演算子の種類が変わったら値フィールドを演算子に合わせて初期化する
      if (isRangeOperator(nextOp)) {
        merged.value = undefined
        merged.values = undefined
        if (merged.valueMin === undefined) merged.valueMin = ""
        if (merged.valueMax === undefined) merged.valueMax = ""
      } else if (isSetOperator(nextOp)) {
        merged.value = undefined
        merged.valueMin = undefined
        merged.valueMax = undefined
        if (!merged.values) merged.values = []
      } else {
        merged.valueMin = undefined
        merged.valueMax = undefined
        merged.values = undefined
        if (merged.value === undefined) merged.value = ""
      }
      return merged
    }))
  }
  const addCondition = (
    setter: (updater: (prev: RelationCondition[]) => RelationCondition[]) => void,
    condition: RelationCondition = newDefaultCondition(),
  ) => setter((prev) => [...prev, condition])
  const removeCondition = (
    setter: (updater: (prev: RelationCondition[]) => RelationCondition[]) => void,
    index: number,
  ) => setter((prev) => prev.filter((_, i) => i !== index))

  // 保存ボタンの妥当性・変更検知
  const relValid = editName.trim() !== "" && editPairs.length > 0 &&
    !editPairs.some((p) => !p.sourceClassId || !p.targetClassId) &&
    conditionsValid(editConditions)
  const relDirty = !!selected && (
    editName !== selected.name ||
    editNameEn !== (selected.nameEn ?? "") ||
    editDesc !== (selected.description ?? "") ||
    JSON.stringify(editPairs) !== JSON.stringify(selected.classPairs ?? []) ||
    JSON.stringify(normalizeConditions(editConditions)) !== JSON.stringify(selected.conditions ?? [])
  )

  const renderAttrSection = (title: string, attrs: OntologyAttribute[], section: AttrSectionKey) => {
    const hasRows = attrs.length > 0
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
          <Button size="sm" variant="outline" className="h-7 gap-1 bg-transparent text-xs"
            onClick={() => openAddAttr(section)}>
            <Plus className="h-3 w-3" />追加
          </Button>
        </div>
        {!hasRows ? (
          <p className="rounded-lg border border-dashed border-border py-3 text-center text-xs text-muted-foreground">
            なし
          </p>
        ) : (
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="font-semibold text-foreground">属性名</TableHead>
                  <TableHead className="w-24 font-semibold text-foreground">データ型</TableHead>
                  <TableHead className="w-20 font-semibold text-foreground">必須/任意</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {attrs.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium text-foreground">
                      <div className="flex items-center gap-1.5">
                        <span>{a.name}</span>
                        {a.description && (
                          <Tooltip content={a.description}>
                            <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground/50 transition-colors hover:text-muted-foreground" />
                          </Tooltip>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{a.dataType}</TableCell>
                    <TableCell>
                      <Badge variant={a.required === "必須" ? "default" : "secondary"} className="font-normal">
                        {a.required}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-0.5">
                        <Button variant="ghost" size="icon" className="h-7 w-7"
                          onClick={() => openEditAttr(a, section)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDeleteAttr(a, section)}>
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
    )
  }

  const scopeWarningText = (section: AttrSectionKey) =>
    section === "project"
      ? "この属性はプロジェクト全体で共有されます。変更はすべてのクラス・リレーションに影響します。"
      : null

  // 成立条件エディタ（追加ダイアログ・詳細パネルの双方で使用）
  const renderConditionsEditor = (
    conditions: RelationCondition[],
    setConditions: (updater: (prev: RelationCondition[]) => RelationCondition[]) => void,
  ) => (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">
        ※ 以下の条件を<strong className="font-medium text-foreground">「すべて満たす場合」</strong>に成立します。
      </p>
      {conditions.length === 0 ? (
        <p className="rounded-md border border-dashed border-border py-2 text-center text-xs text-muted-foreground">
          条件なし（常に成立）
        </p>
      ) : (
        <div className="space-y-1.5">
          {conditions.map((c, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input
                className="h-8 min-w-0 flex-1"
                placeholder="変数名"
                value={c.variable}
                onChange={(e) => updateCondition(setConditions, i, { variable: e.target.value })}
              />
              <Select
                value={c.operator}
                onValueChange={(v) => updateCondition(setConditions, i, { operator: v as RelationConditionOperator })}
              >
                <SelectTrigger className="h-8 w-24 shrink-0">
                  <SelectValue>
                    {CONDITION_OPERATORS.find((o) => o.value === c.operator)?.symbol ?? c.operator}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CONDITION_OPERATORS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      <span className="inline-block w-16 font-mono">{o.symbol}</span>
                      <span className="text-muted-foreground">{o.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isRangeOperator(c.operator) ? (
                <div className="flex min-w-0 flex-1 items-center gap-1">
                  <Input
                    className="h-8 min-w-0 flex-1"
                    placeholder="下限"
                    value={c.valueMin ?? ""}
                    onChange={(e) => updateCondition(setConditions, i, { valueMin: e.target.value })}
                  />
                  <span className="shrink-0 text-xs text-muted-foreground">〜</span>
                  <Input
                    className="h-8 min-w-0 flex-1"
                    placeholder="上限"
                    value={c.valueMax ?? ""}
                    onChange={(e) => updateCondition(setConditions, i, { valueMax: e.target.value })}
                  />
                </div>
              ) : isSetOperator(c.operator) ? (
                <Input
                  className="h-8 min-w-0 flex-1"
                  placeholder="値1, 値2, ... (カンマ区切り)"
                  value={formatValues(c.values)}
                  onChange={(e) => updateCondition(setConditions, i, { values: parseValues(e.target.value) })}
                />
              ) : (
                <Input
                  className="h-8 min-w-0 flex-1"
                  placeholder="値"
                  value={c.value ?? ""}
                  onChange={(e) => updateCondition(setConditions, i, { value: e.target.value })}
                />
              )}
              <Input
                className="h-8 w-16 shrink-0"
                placeholder="単位"
                value={c.unit ?? ""}
                onChange={(e) => updateCondition(setConditions, i, { unit: e.target.value })}
              />
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0 text-muted-foreground"
                onClick={() => removeCondition(setConditions, i)}
                aria-label="この条件を削除"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <Button size="sm" variant="outline" className="gap-1 bg-transparent" onClick={() => addCondition(setConditions)}>
        <Plus className="h-3.5 w-3.5" />条件を追加
      </Button>
    </div>
  )

  return (
    <div className="flex h-full flex-col">
      <TopBar group="オントロジー設計" title="リレーション管理">
        <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-transparent"
          onClick={handleExport} disabled={!currentProject || relations.length === 0 || exporting}>
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          エクスポート
        </Button>
        <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-transparent"
          onClick={() => setShowImport(true)} disabled={!currentProject}>
          <Upload className="h-3.5 w-3.5" />インポート
        </Button>
      </TopBar>
      <div className="flex flex-1 overflow-hidden">
        {/* 一覧（表） */}
        <div className="flex flex-1 flex-col overflow-hidden border-r border-border">
          <div className="flex items-center justify-between gap-3 px-6 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <h2 className="shrink-0 text-base font-semibold text-foreground">リレーション一覧</h2>
              <ViewToggle value={viewMode} onChange={changeViewMode} />
              <button
                type="button"
                className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
                onClick={() => setShowGroupManager(true)}
                disabled={!currentProject}
              >
                グループを管理
              </button>
            </div>
            <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1.5 bg-transparent"
              onClick={() => { setNewName(""); setNewNameEn(""); setNewDesc(""); setNewPairs([{ sourceClassId: "", targetClassId: "" }]); setNewIncludeChildren(true); setNewConditions([]); setShowAdd(true) }}>
              <Plus className="h-3.5 w-3.5" />追加
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
              <button
                key={opt.key}
                type="button"
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-full border px-2.5 py-0.5 transition-colors",
                  filterState === opt.key
                    ? "border-indigo-400 bg-indigo-100 text-indigo-800 dark:border-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
                onClick={() => setFilterState(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {selectedIds.size > 0 && (canBulkConfirm || canBulkUnconfirm) && (
            <div className="flex items-center gap-2 px-6 pb-3 text-xs">
              <span className="text-muted-foreground">{selectedIds.size}件を：</span>
              {canBulkConfirm && (
                <Button size="sm" variant="outline" className="h-7 gap-1.5 bg-transparent" onClick={() => setShowBulkConfirm(true)}>
                  <CheckCircle2 className="h-3.5 w-3.5" />確認する
                </Button>
              )}
              {canBulkUnconfirm && (
                <Button size="sm" variant="outline" className="h-7 gap-1.5 bg-transparent" onClick={handleBulkUnconfirm} disabled={bulkUnconfirming}>
                  {bulkUnconfirming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                  確認を取り消す
                </Button>
              )}
            </div>
          )}
          <div className={cn("flex-1 px-6 pb-6", viewMode === "board" ? "min-h-0 overflow-hidden" : "overflow-auto")}>
            {loading && relations.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : relations.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">
                {currentProject ? "リレーションが登録されていません" : "プロジェクトを選択してください"}
              </p>
            ) : viewMode === "board" ? (
              <GroupBoard
                items={displayedRelations}
                groups={groups}
                selectedId={selectedId}
                onSelect={(id) => setSelectedId((prev) => (prev === id ? null : id))}
                onReorder={applyReorder}
              />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="w-10">
                        <input
                          type="checkbox"
                          aria-label="表示中のリレーションをすべて選択"
                          checked={displayedRelations.length > 0 && displayedRelations.every((r) => selectedIds.has(r.id))}
                          onChange={(e) => {
                            const next = new Set(selectedIds)
                            if (e.target.checked) displayedRelations.forEach((r) => next.add(r.id))
                            else displayedRelations.forEach((r) => next.delete(r.id))
                            setSelectedIds(next)
                          }}
                        />
                      </TableHead>
                      <TableHead className="w-[28%] font-semibold text-foreground">リレーション名</TableHead>
                      <TableHead className="w-44 pr-4 font-semibold text-foreground">確認</TableHead>
                      <TableHead className="w-20 font-semibold text-foreground">条件</TableHead>
                      <TableHead className="font-semibold text-foreground">始点(A) → 終点(B)クラス</TableHead>
                      {canReorder && <TableHead className="w-20 font-semibold text-foreground">並び</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {listRows.map((row) => {
                      if (row.kind === "group") {
                        return (
                          <TableRow key={row.key} className="bg-muted/40 hover:bg-muted/40">
                            <TableCell colSpan={canReorder ? 6 : 5} className="py-1.5">
                              <span className="flex items-center gap-2 text-xs font-semibold text-foreground">
                                <span
                                  className="h-2.5 w-2.5 rounded-full border border-border"
                                  style={row.group?.color ? { backgroundColor: row.group.color } : undefined}
                                />
                                {row.group?.name ?? "未分類"}
                                <span className="font-normal text-muted-foreground">{row.count}件</span>
                              </span>
                            </TableCell>
                          </TableRow>
                        )
                      }
                      const r = row.rel
                      const isSel = selectedId === r.id
                      const pairs = r.classPairs ?? []
                      const confirmStatus = deriveConfirmationStatus(r.confirmations)
                      const state = confirmStatus.state
                      const isChecked = selectedIds.has(r.id)
                      return (
                        <TableRow
                          key={row.key}
                          className={cn(
                            "cursor-pointer transition-colors",
                            isSel
                              ? "bg-indigo-100 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-950/50"
                              : "hover:bg-muted/50",
                          )}
                          onClick={() => setSelectedId(r.id)}
                        >
                          <TableCell className="align-top" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              aria-label={`${r.name}を選択`}
                              checked={isChecked}
                              onChange={() => toggleSelect(r.id)}
                            />
                          </TableCell>
                          <TableCell className="align-top">
                            <span className="flex items-center gap-1 font-medium text-foreground">
                              <span className="truncate" title={r.name}>{r.name}</span>
                              {relationIncomplete(r) && (
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
                              )}
                            </span>
                            {r.nameEn && <span className="block truncate text-xs text-muted-foreground">{r.nameEn}</span>}
                          </TableCell>
                          <TableCell className="align-top pr-4">
                            <ConfirmationBadge state={state} latestConfirm={confirmStatus.latestConfirm} />
                          </TableCell>
                          <TableCell className="align-top text-sm text-foreground">
                            {hasConditions(r.conditions) ? "あり" : null}
                          </TableCell>
                          <TableCell className="align-top text-sm text-muted-foreground">
                            {pairs.length > 0 ? (
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                {pairs.slice(0, 3).map((p, i) => (
                                  <span key={i} className="inline-flex items-center gap-1 whitespace-nowrap">
                                    <span className={cn(classMissing(p.sourceClassId) && "font-medium text-amber-600 dark:text-amber-500")}>
                                      {className(p.sourceClassId)}
                                    </span>
                                    <ArrowRight className="h-3 w-3 shrink-0" />
                                    <span className={cn(classMissing(p.targetClassId) && "font-medium text-amber-600 dark:text-amber-500")}>
                                      {className(p.targetClassId)}
                                    </span>
                                  </span>
                                ))}
                                {pairs.length > 3 && (
                                  <span className="whitespace-nowrap text-xs text-muted-foreground">＋他{pairs.length - 3}件（詳細で確認）</span>
                                )}
                              </div>
                            ) : "—"}
                          </TableCell>
                          {canReorder && (
                            <TableCell className="align-top" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center gap-0.5">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6"
                                  aria-label={`${r.name}を上へ`}
                                  disabled={row.index === 0 || movingGroup}
                                  onClick={() => moveRelation(row.siblingIds, row.index, -1)}
                                >
                                  <ArrowUp className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6"
                                  aria-label={`${r.name}を下へ`}
                                  disabled={row.index === row.siblingIds.length - 1 || movingGroup}
                                  onClick={() => moveRelation(row.siblingIds, row.index, 1)}
                                >
                                  <ArrowDown className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>

        {/* 詳細（常に編集可）。非選択のときは出さず、一覧・ボードを全幅にする */}
        {selected && (
          <div className="flex w-[30rem] shrink-0 flex-col overflow-hidden bg-card">
              <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
                {relationIncomplete(selected) && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      始点(A)または終点(B)のクラスが未設定、または削除されており（「不明」と表示）、このリレーション定義は不完全です。始点(A)・終点(B)クラスを設定し直してください。
                    </span>
                  </div>
                )}

                {/* 基本情報 */}
                <section className="space-y-3">
                  <SectionHeader icon={FileText} title="基本情報" />
                  <div className="space-y-3">
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <ConfirmationSummary events={selected.confirmations} fieldLabels={RELATION_FIELD_LABEL} />
                      <p>登録日 {formatDateTime(selected.createdAt)}{selected.createdBy ? `（${selected.createdBy}）` : ""}</p>
                      <p>更新日 {formatDateTime(selected.updatedAt)}{selected.updatedBy ? `（${selected.updatedBy}）` : ""}</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">リレーション名（日本語名） <span className="text-destructive">*</span></Label>
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-8" placeholder="例：引き起こす" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">リレーション名（英語名）</Label>
                      <Input value={editNameEn} onChange={(e) => setEditNameEn(e.target.value)} className="h-8" placeholder="例：causes" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">始点(A)・終点(B)クラスのペア <span className="text-destructive">*</span></Label>
                      <div className="space-y-2">
                        {editPairs.map((pair, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <Select value={pair.sourceClassId || "__none__"}
                              onValueChange={(v) => updateEditPair(i, "sourceClassId", v && v !== "__none__" ? v : "")}>
                              <SelectTrigger className="h-8 min-w-0 flex-1">
                                <SelectValue>{pair.sourceClassId ? className(pair.sourceClassId) : "始点(A)クラス"}</SelectValue>
                              </SelectTrigger>
                              <SelectContent className="max-h-72">
                                {classes.map((c) => (
                                  <SelectItem key={c.id} value={c.id}>{c.name}{c.nameEn && <span className="ml-1.5 text-xs text-muted-foreground">{c.nameEn}</span>}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <ArrowRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                            <Select value={pair.targetClassId || "__none__"}
                              onValueChange={(v) => updateEditPair(i, "targetClassId", v && v !== "__none__" ? v : "")}>
                              <SelectTrigger className="h-8 min-w-0 flex-1">
                                <SelectValue>{pair.targetClassId ? className(pair.targetClassId) : "終点(B)クラス"}</SelectValue>
                              </SelectTrigger>
                              <SelectContent className="max-h-72">
                                {classes.map((c) => (
                                  <SelectItem key={c.id} value={c.id}>{c.name}{c.nameEn && <span className="ml-1.5 text-xs text-muted-foreground">{c.nameEn}</span>}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {editPairs.length > 1 && (
                              <Button size="icon" variant="ghost" className="h-8 w-8 flex-shrink-0 text-muted-foreground"
                                onClick={() => removeEditPair(i)}>
                                <X className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                      <Button size="sm" variant="outline" className="gap-1 bg-transparent" onClick={addEditPair}>
                        <Plus className="h-3.5 w-3.5" />ペアを追加
                      </Button>
                      {pairsHaveParent(editPairs) && (
                        <label className="mt-1 flex cursor-pointer items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
                          <input type="checkbox" checked={editIncludeChildren}
                            onChange={(e) => setEditIncludeChildren(e.target.checked)}
                            className="mt-0.5 h-4 w-4 accent-indigo-600" />
                          <span className="text-xs text-muted-foreground">
                            親クラスを指定したペアは、その<strong className="font-medium text-foreground">子クラスも対象に含める</strong>（推奨）。保存時に子クラス分のペアへ自動展開します。
                          </span>
                        </label>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">説明</Label>
                      <Textarea rows={4} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">グループ</Label>
                      <Select
                        value={selectedGroup?.id ?? "__none__"}
                        onValueChange={(v) => handleChangeGroup(selected.id, v === "__none__" ? null : v)}
                      >
                        <SelectTrigger className="h-8" disabled={movingGroup}>
                          <SelectValue>{selectedGroup?.name ?? "未分類"}</SelectValue>
                        </SelectTrigger>
                        <SelectContent className="max-h-72">
                          <SelectItem value="__none__">未分類</SelectItem>
                          {groups.map((g) => (
                            <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        一覧を見やすくするための整理用の区分です。オントロジーの意味やエクスポートには影響しません（選ぶと即座に保存されます）。
                      </p>
                    </div>
                  </div>
                </section>

                {/* 成立条件 */}
                <section className="space-y-3">
                  <SectionHeader icon={Filter} title="成立条件" />
                  {renderConditionsEditor(editConditions, setEditConditions)}
                </section>

                {/* 属性 */}
                <section className="space-y-4">
                  <SectionHeader icon={Tags} title="属性" />
                  {loadingAttrs ? (
                    <div className="flex h-20 items-center justify-center text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {renderAttrSection("プロジェクト共通属性", projectAttrs, "project")}
                      {renderAttrSection("リレーション固有属性", ownAttrs, "own")}
                    </div>
                  )}
                </section>
              </div>

              {/* フッター：削除・保存 */}
              <div className="flex items-center justify-between border-t border-border px-4 py-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setShowDelete(true)}
                >
                  <Trash2 className="h-3.5 w-3.5" />削除
                </Button>
                <Button size="sm" variant="success" onClick={handleSave} disabled={!relValid || saving || !relDirty}>
                  {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}保存
                </Button>
              </div>
          </div>
        )}
      </div>

      {/* リレーション追加ダイアログ */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>リレーションを追加</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>リレーション名 <span className="text-destructive">*</span></Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)}
                placeholder="例：引き起こす" />
            </div>
            <div className="space-y-2">
              <Label>英語名</Label>
              <Input value={newNameEn} onChange={(e) => setNewNameEn(e.target.value)}
                placeholder="例：causes" />
            </div>
            <div className="space-y-2">
              <Label>始点(A)・終点(B)クラスのペア <span className="text-destructive">*</span></Label>
              <div className="space-y-2">
                {newPairs.map((pair, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Select value={pair.sourceClassId || "__none__"}
                      onValueChange={(v) => updateNewPair(i, "sourceClassId", v && v !== "__none__" ? v : "")}>
                      <SelectTrigger className="min-w-0 flex-1">
                        <SelectValue>{pair.sourceClassId ? className(pair.sourceClassId) : "始点(A)クラス"}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {classes.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}{c.nameEn && <span className="ml-1.5 text-xs text-muted-foreground">{c.nameEn}</span>}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <ArrowRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    <Select value={pair.targetClassId || "__none__"}
                      onValueChange={(v) => updateNewPair(i, "targetClassId", v && v !== "__none__" ? v : "")}>
                      <SelectTrigger className="min-w-0 flex-1">
                        <SelectValue>{pair.targetClassId ? className(pair.targetClassId) : "終点(B)クラス"}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {classes.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}{c.nameEn && <span className="ml-1.5 text-xs text-muted-foreground">{c.nameEn}</span>}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {newPairs.length > 1 && (
                      <Button size="icon" variant="ghost" className="h-8 w-8 flex-shrink-0 text-muted-foreground"
                        onClick={() => removeNewPair(i)}>
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <Button size="sm" variant="outline" className="gap-1 bg-transparent"
                onClick={addNewPair}>
                <Plus className="h-3.5 w-3.5" />
                ペアを追加
              </Button>
              {pairsHaveParent(newPairs) && (
                <label className="mt-1 flex cursor-pointer items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
                  <input type="checkbox" checked={newIncludeChildren}
                    onChange={(e) => setNewIncludeChildren(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-indigo-600" />
                  <span className="text-xs text-muted-foreground">
                    親クラスを指定したペアは、その<strong className="font-medium text-foreground">子クラスも対象に含める</strong>（推奨）。登録時に子クラス分のペアへ自動展開します。
                  </span>
                </label>
              )}
            </div>
            <div className="space-y-2">
              <Label>説明</Label>
              <Textarea rows={3} value={newDesc} onChange={(e) => setNewDesc(e.target.value)}
                placeholder="リレーションの意味・用途を記述" />
            </div>
            <div className="space-y-2">
              <Label>成立条件</Label>
              {renderConditionsEditor(newConditions, setNewConditions)}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>キャンセル</Button>
            <Button onClick={handleAdd}
              disabled={!newName.trim() || newPairs.length === 0 || newPairs.some(p => !p.sourceClassId || !p.targetClassId) || !conditionsValid(newConditions) || adding}>
              {adding ? "登録中..." : "登録"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 属性追加ダイアログ */}
      <Dialog open={showAddAttr} onOpenChange={setShowAddAttr}>
        <DialogContent>
          <DialogHeader><DialogTitle>属性を追加</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {addAttrSection === "project" && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  プロジェクト全体の共通属性として追加されます。全クラス・リレーションに適用されます。
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label>属性名 <span className="text-destructive">*</span></Label>
              <Input value={attrName} onChange={(e) => setAttrName(e.target.value)} placeholder="例：備考" />
            </div>
            <div className="space-y-2">
              <Label>説明</Label>
              <Textarea rows={2} value={attrDesc} onChange={(e) => setAttrDesc(e.target.value)}
                placeholder="属性の意味・用途を記述" />
            </div>
            <div className="space-y-2">
              <Label>データ型</Label>
              <Select value={attrDataType} onValueChange={(v) => { if (v) setAttrDataType(v) }}>
                <SelectTrigger><SelectValue>{attrDataType}</SelectValue></SelectTrigger>
                <SelectContent>
                  {["文字列", "数値", "日付", "真偽値"].map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>必須／任意</Label>
              <Select value={attrRequired} onValueChange={(v) => setAttrRequired(v as AttributeRequired)}>
                <SelectTrigger><SelectValue>{attrRequired}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="必須">必須</SelectItem>
                  <SelectItem value="任意">任意</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddAttr(false)}>キャンセル</Button>
            <Button onClick={handleAddAttr} disabled={!attrName.trim() || addingAttr}>
              {addingAttr ? "追加中..." : "追加"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 属性編集ダイアログ */}
      <Dialog open={showEditAttr} onOpenChange={setShowEditAttr}>
        <DialogContent>
          <DialogHeader><DialogTitle>属性を編集</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {editAttrSection === "project" && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {scopeWarningText(editAttrSection)}
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label>属性名 <span className="text-destructive">*</span></Label>
              <Input value={editAttrName} onChange={(e) => setEditAttrName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>説明</Label>
              <Textarea rows={2} value={editAttrDesc} onChange={(e) => setEditAttrDesc(e.target.value)}
                placeholder="属性の意味・用途を記述" />
            </div>
            <div className="space-y-2">
              <Label>データ型</Label>
              <Select value={editAttrDataType} onValueChange={(v) => { if (v) setEditAttrDataType(v) }}>
                <SelectTrigger><SelectValue>{editAttrDataType}</SelectValue></SelectTrigger>
                <SelectContent>
                  {["文字列", "数値", "日付", "真偽値"].map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>必須／任意</Label>
              <Select value={editAttrRequired} onValueChange={(v) => setEditAttrRequired(v as AttributeRequired)}>
                <SelectTrigger><SelectValue>{editAttrRequired}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="必須">必須</SelectItem>
                  <SelectItem value="任意">任意</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowEditAttr(false); setEditingAttr(null) }}>
              キャンセル
            </Button>
            <Button onClick={handleEditAttr} disabled={!editAttrName.trim() || savingAttr}>
              {savingAttr ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 属性削除確認ダイアログ */}
      <Dialog open={showAttrAlert} onOpenChange={setShowAttrAlert}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {attrAlertIsWarning && <AlertTriangle className="h-5 w-5 text-amber-500" />}
              {attrAlertIsWarning ? "影響範囲の確認" : "削除の確認"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{attrAlertMsg}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAttrAlert(false); setPendingAttrAction(null) }}>
              キャンセル
            </Button>
            <Button variant="destructive" onClick={() => {
              setShowAttrAlert(false)
              pendingAttrAction?.fn()
              setPendingAttrAction(null)
            }}>
              削除する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* リレーション削除確認ダイアログ */}
      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent>
          <DialogHeader><DialogTitle>リレーションを削除</DialogTitle></DialogHeader>
          {selected && deriveConfirmationStatus(selected.confirmations).state !== "unconfirmed" ? (
            <p className="text-sm font-medium text-destructive">
              「{selected.name}」は確認済みのリレーションです。本当に削除しますか？ この操作は取り消せません。
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              「{selected?.name}」を削除します。この操作は取り消せません。
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)} disabled={deleting}>
              キャンセル
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "削除中..." : "削除する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* リレーション定義インポート */}
      {currentProject && (
        <GroupManagerDialog
          open={showGroupManager}
          onOpenChange={setShowGroupManager}
          projectId={currentProject.id}
          target="relation"
          groups={groups}
          onSaved={(saved) => {
            setGroups(saved)
            // 削除されたグループを指していた分は未分類に戻る（サーバ側で groupId を外す）
            fetchRelations()
          }}
        />
      )}

      <ImportDialog<RelationExportItem>
        open={showImport}
        onOpenChange={setShowImport}
        title="リレーション定義をインポート"
        entityLabel="リレーション"
        parse={parseRelationsYaml}
        preview={(items, mode) => previewRelationsImport(items, relations, classes, mode)}
        onExecute={async (items, mode) => {
          if (!currentProject) throw new Error("プロジェクトが選択されていません")
          const result = await executeRelationsImport(currentProject.id, items, relations, classes, mode)
          return { created: result.created, updated: result.updated, deleted: result.deleted }
        }}
        onImported={async () => {
          setSelectedId(null)
          await fetchRelations()
        }}
      />

      {/* 一括確認ダイアログ */}
      <ConfirmDialog
        open={showBulkConfirm}
        onOpenChange={setShowBulkConfirm}
        title={`選択した${selectedIds.size}件のリレーションを確認する`}
        description="選択したすべてのリレーションに同一の確認レコードが追加されます。"
        submitting={bulkConfirming}
        onSubmit={handleBulkConfirm}
      />
    </div>
  )
}
