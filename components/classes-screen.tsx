"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
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
import { GroupBoard, ViewToggle, type BoardItem, type BoardViewMode, type ReorderUpdate } from "@/components/group-board"
import { DragRow, DropRow, ListDndContext } from "@/components/list-dnd"
import { cn } from "@/lib/utils"
import { UNGROUPED, nextOrder, placeAt, reorderUpdates, rootOf, sortByOrder, sortGroups } from "@/lib/organize"
import type { OntologyClass, OntologyAttribute, OntologyGroup, OntologyRelation, AttributeRequired } from "@/lib/types"
import {
  buildClassesYaml,
  downloadYaml,
  parseClassesYaml,
  previewClassesImport,
  executeClassesImport,
  type ClassExportItem,
} from "@/lib/import-export"
import { deriveConfirmationStatus, type ConfirmationState } from "@/lib/confirmation"
import { ConfirmationBadge } from "@/components/confirmation-badge"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { ConfirmationSummary } from "@/components/confirmation-summary"
import { SynonymInput } from "@/components/synonym-input"
import { Plus, Pencil, Trash2, Loader2, AlertTriangle, Info, Download, Upload, FileText, Tags, Link2, CheckCircle2, X } from "lucide-react"
import { useProject } from "@/app/project-context"

type TreeNode = OntologyClass & { children: TreeNode[] }
type ClassRow = { node: TreeNode; depth: number }

// グループ見出し行の id。落とし先としてクラスの id と区別するために前置きする。
const GROUP_ROW_PREFIX = "group:"
type AttrSectionKey = "project" | "parent" | "own"

const CLASS_FIELD_LABEL: Record<string, string> = {
  name: "クラス名",
  nameEn: "英語名",
  synonyms: "同義語",
  description: "説明",
  parentId: "親クラス",
  attributes: "属性",
}

function formatDateTime(iso: string | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
}

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

// きょうだい同士を order で並べたツリー（深さを問わず同じ規則で並べる）
function sortTree(nodes: TreeNode[]): TreeNode[] {
  return sortByOrder(nodes).map((n) => ({ ...n, children: sortTree(n.children) }))
}

export function ClassesScreen({ initialSelectedId, active }: { initialSelectedId?: string; active?: boolean }) {
  const { currentProject, loading: projectLoading } = useProject()
  const [classes, setClasses] = useState<OntologyClass[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // クラス追加ダイアログ
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState("")
  const [newNameEn, setNewNameEn] = useState("")
  const [newSynonyms, setNewSynonyms] = useState<string[]>([])
  const [addError, setAddError] = useState<string | null>(null)
  const [newDesc, setNewDesc] = useState("")
  const [newParentId, setNewParentId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  // 連続追加で、このダイアログを開いてから登録した名前（作業の控え）
  const [addedNames, setAddedNames] = useState<string[]>([])
  const newNameRef = useRef<HTMLInputElement>(null)

  // クラス編集（右詳細パネルで常時編集可）
  const [editName, setEditName] = useState("")
  const [editNameEn, setEditNameEn] = useState("")
  const [editSynonyms, setEditSynonyms] = useState<string[]>([])
  const [saveError, setSaveError] = useState<string | null>(null)
  const [editDesc, setEditDesc] = useState("")
  const [editParentId, setEditParentId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // クラス削除確認ダイアログ
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteInstanceCount, setDeleteInstanceCount] = useState(0)
  const [loadingDeleteInfo, setLoadingDeleteInfo] = useState(false)
  const [deleteChildMode, setDeleteChildMode] = useState<"cascade" | "promote">("promote")
  const [deleteInstanceMode, setDeleteInstanceMode] = useState<"delete" | "unclassify">("unclassify")

  // リレーション
  const [relations, setRelations] = useState<OntologyRelation[]>([])

  // 属性 (3種)
  const [projectAttrs, setProjectAttrs] = useState<OntologyAttribute[]>([])
  const [inheritedAttrs, setInheritedAttrs] = useState<OntologyAttribute[]>([])
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

  // スコープ警告（削除時の確認）
  const [showScopeAlert, setShowScopeAlert] = useState(false)
  const [scopeAlertMsg, setScopeAlertMsg] = useState("")
  const [scopeAlertIsWarning, setScopeAlertIsWarning] = useState(false)
  const [pendingAction, setPendingAction] = useState<{ fn: () => Promise<void> } | null>(null)

  // 整理用グループ。ツリー表示（継承の親子）とグループ表示（整理の束ね）を切り替える。
  //   継承は意味、グループは整理の都合なので、同じリストで混ぜずに表示を分ける。
  const { groups, setGroups, refresh: refreshGroups } = useGroups(currentProject?.id, "class")
  const [viewMode, setViewMode] = useState<BoardViewMode>("list")
  const [showGroupManager, setShowGroupManager] = useState(false)
  const [movingGroup, setMovingGroup] = useState(false)

  // ボード表示へ切り替えた時点で選択を外す。整理中は基本情報ペインを出さず全幅で扱う。
  const changeViewMode = (mode: BoardViewMode) => {
    setViewMode(mode)
    if (mode === "board") setSelectedId(null)
  }

  // 確認機構
  const [filterState, setFilterState] = useState<"all" | ConfirmationState>("all")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showBulkConfirm, setShowBulkConfirm] = useState(false)
  const [bulkConfirming, setBulkConfirming] = useState(false)
  const [bulkUnconfirming, setBulkUnconfirming] = useState(false)

  const fetchClasses = useCallback(async () => {
    if (!currentProject) return
    setLoading(true)
    try {
      const [classData, relData] = await Promise.all([
        fetch(`/api/classes?projectId=${currentProject.id}`).then((r) => r.json()),
        fetch(`/api/relations?projectId=${currentProject.id}`).then((r) => r.json()),
      ])
      setClasses(classData)
      setRelations(Array.isArray(relData) ? relData : [])
    } finally {
      setLoading(false)
    }
  }, [currentProject?.id])

  // プロジェクトが切り替わったら前プロジェクトのデータを捨てる（取得は下の表示時 effect が行う）。
  // 同一プロジェクト内では state を保持したままにして、画面を戻したときに即座に一覧を出す。
  useEffect(() => {
    if (projectLoading) return
    setSelectedId(null)
    setClasses([])
    setRelations([])
    setLoading(!!currentProject)
  }, [currentProject?.id, projectLoading])

  // この画面が表示状態になったら再取得する（マウント維持のため、他画面での変更を反映）。
  // 取得中も既存データは表示したままにする（下の描画条件を参照）ので、切替時にちらつかない。
  useEffect(() => {
    if (active && currentProject) {
      fetchClasses()
      refreshGroups()
    }
  }, [active, currentProject?.id, fetchClasses, refreshGroups])

  useEffect(() => {
    if (initialSelectedId && classes.length > 0) {
      setSelectedId(initialSelectedId)
    }
  }, [initialSelectedId, classes.length])

  const fetchAllAttrs = useCallback(async (classId: string, parentClassId: string | null, projectId: string) => {
    setLoadingAttrs(true)
    try {
      const [projData, ownData] = await Promise.all([
        fetch(`/api/attributes?targetId=${projectId}`).then((r) => r.json()),
        fetch(`/api/attributes?targetId=${classId}`).then((r) => r.json()),
      ])
      setProjectAttrs(Array.isArray(projData) ? projData : [])
      setOwnAttrs(Array.isArray(ownData) ? ownData : [])
      if (parentClassId) {
        const parentData = await fetch(`/api/attributes?targetId=${parentClassId}`).then((r) => r.json())
        setInheritedAttrs(Array.isArray(parentData) ? parentData : [])
      } else {
        setInheritedAttrs([])
      }
    } finally {
      setLoadingAttrs(false)
    }
  }, [])

  useEffect(() => {
    if (!selectedId || !currentProject) {
      setProjectAttrs([]); setInheritedAttrs([]); setOwnAttrs([])
      return
    }
    const cls = classes.find((c) => c.id === selectedId)
    // 常時編集可のため、選択のたびに編集フィールドを対象クラスで初期化する
    if (cls) {
      setEditName(cls.name)
      setEditNameEn(cls.nameEn ?? "")
      setEditSynonyms(cls.synonyms ?? [])
      setEditDesc(cls.description)
      setEditParentId(cls.parentId)
    }
    setSaveError(null)
    fetchAllAttrs(selectedId, cls?.parentId ?? null, currentProject.id)
  }, [selectedId, currentProject?.id])

  // keepOpen: ダイアログを閉じずに親クラスを残したまま次の入力を受け付ける（サブクラスの連続作成）
  const handleAdd = async (keepOpen = false) => {
    if (!newName.trim() || !currentProject) return
    setAdding(true)
    setAddError(null)
    try {
      const res = await fetch("/api/classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: currentProject.id,
          name: newName.trim(),
          nameEn: newNameEn.trim(),
          synonyms: newSynonyms,
          description: newDesc.trim(),
          parentId: newParentId,
        }),
      })
      if (!res.ok) {
        // 同義語・クラス名が他クラスと重複している場合など（409）
        const err = await res.json().catch(() => ({}))
        setAddError(err.error ?? "クラスの作成に失敗しました")
        return
      }
      // 一覧はクラス・リレーションの全件を取り直さず、作成結果を足すだけにする
      const created: OntologyClass = await res.json()
      setClasses((prev) => [...prev, created])
      if (keepOpen) {
        // 親クラスはそのまま。名前まわりだけ空けて、すぐ次を打てるようにする
        setAddedNames((prev) => [...prev, created.name])
        setNewName(""); setNewNameEn(""); setNewSynonyms([]); setNewDesc("")
        newNameRef.current?.focus()
        return
      }
      setSelectedId(created.id)
      setShowAdd(false)
      setNewName(""); setNewNameEn(""); setNewSynonyms([]); setNewDesc(""); setNewParentId(null)
      setAddedNames([])
    } finally {
      setAdding(false)
    }
  }

  const handleSave = async () => {
    if (!editName.trim() || !selected) return
    // 親を外して根クラスに戻すとき、グループは「それまで表示されていたグループ」を引き継ぐ。
    // 引き継がないと、自分が昔持っていた groupId に戻って別のレーンへ飛んでしまう。
    const becomesRoot = selected.parentId !== null && editParentId === null
    const keepGroupId = becomesRoot ? (rootOf(selected, classById).groupId ?? null) : null
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch(`/api/classes/${selected.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          nameEn: editNameEn.trim(),
          synonyms: editSynonyms,
          description: editDesc.trim(),
          parentId: editParentId,
        }),
      })
      if (!res.ok) {
        // 同義語・クラス名が他クラスと重複している場合など（409）
        const err = await res.json().catch(() => ({}))
        setSaveError(err.error ?? "クラスの更新に失敗しました")
        return
      }
      if (becomesRoot && keepGroupId !== (selected.groupId ?? null) && currentProject) {
        const roots = classes.filter((c) => c.parentId === null && (c.groupId ?? null) === keepGroupId)
        await fetch("/api/classes/reorder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: currentProject.id,
            updates: [{ id: selected.id, order: nextOrder(roots), groupId: keepGroupId }],
          }),
        })
      }
      await fetchClasses()
    } finally {
      setSaving(false)
    }
  }

  // 削除ダイアログを開きながらインスタンス数を取得
  const openDeleteDialog = async () => {
    setDeleteChildMode("promote")
    setDeleteInstanceMode("unclassify")
    setDeleteInstanceCount(0)
    setShowDelete(true)
    if (!selected) return
    setLoadingDeleteInfo(true)
    try {
      const res = await fetch(`/api/instances?classId=${selected.id}`)
      const insts = await res.json()
      setDeleteInstanceCount(Array.isArray(insts) ? insts.length : 0)
    } finally {
      setLoadingDeleteInfo(false)
    }
  }

  const handleDelete = async () => {
    if (!selected) return
    setDeleting(true)
    try {
      const children = classes.filter((c) => c.parentId === selected.id)

      // 子クラスの処理
      if (hasChildren) {
        if (deleteChildMode === "cascade") {
          await Promise.all(children.map((child) => fetch(`/api/classes/${child.id}`, { method: "DELETE" })))
        } else {
          await Promise.all(children.map((child) =>
            fetch(`/api/classes/${child.id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ parentId: null }),
            })
          ))
        }
      }

      // インスタンスの処理
      if (deleteInstanceCount > 0) {
        const instRes = await fetch(`/api/instances?classId=${selected.id}`)
        const insts = await instRes.json()
        if (Array.isArray(insts)) {
          if (deleteInstanceMode === "delete") {
            await Promise.all(insts.map((inst) => fetch(`/api/instances/${inst.id}`, { method: "DELETE" })))
          } else {
            await Promise.all(insts.map((inst) =>
              fetch(`/api/instances/${inst.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ classId: null }),
              })
            ))
          }
        }
      }

      await fetch(`/api/classes/${selected.id}`, { method: "DELETE" })
      await fetchClasses()
      setSelectedId(null)
      setShowDelete(false)
    } finally {
      setDeleting(false)
    }
  }

  // 属性追加ダイアログを開く
  const openAddAttr = (section: AttrSectionKey) => {
    setAddAttrSection(section)
    setAttrName(""); setAttrDesc(""); setAttrDataType("文字列"); setAttrRequired("任意")
    setShowAddAttr(true)
  }

  const handleAddAttr = async () => {
    if (!attrName.trim() || !selected || !currentProject) return
    setAddingAttr(true)
    try {
      let targetId: string
      let targetType: "project" | "class"
      let scope: "共通" | "固有"

      if (addAttrSection === "project") {
        targetId = currentProject.id; targetType = "project"; scope = "共通"
      } else if (addAttrSection === "parent") {
        targetId = selected.parentId!; targetType = "class"; scope = "固有"
      } else {
        targetId = selected.id; targetType = "class"; scope = "固有"
      }

      await fetch("/api/attributes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: currentProject.id,
          name: attrName.trim(),
          description: attrDesc.trim(),
          dataType: attrDataType,
          required: attrRequired,
          scope,
          targetId,
          targetType,
        }),
      })
      await fetchAllAttrs(selected.id, selected.parentId, currentProject.id)
      setShowAddAttr(false)
      setAttrName(""); setAttrDesc(""); setAttrDataType("文字列"); setAttrRequired("任意")
    } finally {
      setAddingAttr(false)
    }
  }

  // 属性編集ダイアログを開く
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
      await fetchAllAttrs(selected.id, selected.parentId, currentProject.id)
      setShowEditAttr(false)
      setEditingAttr(null)
    } finally {
      setSavingAttr(false)
    }
  }

  // 削除: スコープ外なら確認ダイアログ経由
  const handleDeleteAttr = (attr: OntologyAttribute, section: AttrSectionKey) => {
    const doDelete = async () => {
      await fetch(`/api/attributes/${attr.id}`, { method: "DELETE" })
      if (selected && currentProject) {
        await fetchAllAttrs(selected.id, selected.parentId, currentProject.id)
      }
    }

    const isWarning = section !== "own"
    const msg = section === "project"
      ? `「${attr.name}」はプロジェクト全体の共通属性です。削除するとすべてのクラスから除去されます。`
      : section === "parent"
      ? `「${attr.name}」は「${parentName}」クラスの属性です。削除するとそのクラス全体に影響します。`
      : `「${attr.name}」を削除します。この操作は取り消せません。`
    setScopeAlertMsg(msg)
    setScopeAlertIsWarning(isWarning)
    setPendingAction({ fn: doDelete })
    setShowScopeAlert(true)
  }

  // 選択中のクラスを親の初期値にする（そのままサブクラスを足せるように）。
  // 親に選べるのは根クラスだけなので、選択がサブクラスならその親を引き継ぐ。
  const openAddDialog = () => {
    const base = selectedId ? classes.find((c) => c.id === selectedId) : undefined
    setNewName(""); setNewNameEn(""); setNewSynonyms([]); setNewDesc("")
    setNewParentId(base ? (base.parentId ?? base.id) : null)
    setAddedNames([])
    setAddError(null)
    setShowAdd(true)
  }

  const handleExport = async () => {
    if (!currentProject || classes.length === 0) return
    setExporting(true)
    try {
      const attrsByClassId = new Map<string, OntologyAttribute[]>()
      await Promise.all(classes.map(async (c) => {
        const attrs = await fetch(`/api/attributes?targetId=${c.id}`).then((r) => r.json())
        attrsByClassId.set(c.id, Array.isArray(attrs) ? attrs : [])
      }))
      const yamlText = buildClassesYaml(classes, attrsByClassId)
      downloadYaml(`classes_${currentProject.name}.yaml`, yamlText)
    } finally {
      setExporting(false)
    }
  }

  // グループごとにツリーを組む。サブクラスのグループは親（根）に従うので、
  // ひとつの木がグループをまたいで分断されることはない。
  const groupSections = useMemo(() => {
    const known = new Set(groups.map((g) => g.id))
    const byId = new Map(classes.map((c) => [c.id, c]))
    const buckets = new Map<string, OntologyClass[]>()
    for (const c of classes) {
      const gid = rootOf(c, byId).groupId ?? null
      const key = gid && known.has(gid) ? gid : UNGROUPED
      const list = buckets.get(key)
      if (list) list.push(c)
      else buckets.set(key, [c])
    }
    const matches = (c: OntologyClass) =>
      filterState === "all" || deriveConfirmationStatus(c.confirmations).state === filterState
    // 子が条件に合うときは親も残す。親を落とすと子の居場所（階層）が分からなくなるため。
    const prune = (nodes: TreeNode[]): TreeNode[] =>
      nodes.flatMap((n) => {
        const children = prune(n.children)
        return matches(n) || children.length > 0 ? [{ ...n, children }] : []
      })
    const build = (group: OntologyGroup | null, list: OntologyClass[]) => {
      const trees = prune(sortTree(buildTree(list)))
      const rows: ClassRow[] = []
      const walk = (nodes: TreeNode[], depth: number) => {
        for (const n of nodes) {
          rows.push({ node: n, depth })
          if (n.children.length) walk(n.children, depth + 1)
        }
      }
      walk(trees, 0)
      return { group, trees, rows }
    }
    const sections = sortGroups(groups).map((g) => build(g, buckets.get(g.id) ?? []))
    sections.push(build(null, buckets.get(UNGROUPED) ?? []))
    return sections
  }, [classes, groups, filterState])

  const flatClasses = useMemo(() => groupSections.flatMap((s) => s.rows), [groupSections])

  type ListRow =
    | { kind: "group"; key: string; group: OntologyGroup | null; count: number }
    | ({ kind: "class"; key: string } & ClassRow)

  // グループが未作成のうちは見出しを出さない（従来のツリー一覧と同じ見た目になる）
  const listRows: ListRow[] =
    groups.length === 0
      ? flatClasses.map((row) => ({ kind: "class" as const, key: row.node.id, ...row }))
      : groupSections.flatMap((section) => {
          if (!section.group && section.rows.length === 0) return []
          return [
            {
              kind: "group" as const,
              key: `${GROUP_ROW_PREFIX}${section.group?.id ?? "ungrouped"}`,
              group: section.group,
              count: section.rows.length,
            },
            ...section.rows.map((row) => ({ kind: "class" as const, key: row.node.id, ...row })),
          ]
        })

  // 整理ボードへ渡す項目（確認状態フィルタはボードにも効かせる）。
  // ドラッグできるのは根クラスだけで、サブクラスはカードの中に入れ子で付いていく。
  const boardItems = useMemo(() => {
    const toItem = (n: TreeNode): BoardItem => ({
      id: n.id,
      name: n.name,
      nameEn: n.nameEn,
      groupId: n.groupId,
      order: n.order,
      createdAt: n.createdAt,
      children: n.children.map(toItem),
    })
    return groupSections.flatMap((section) => section.trees.map(toItem))
  }, [groupSections])

  // ボード上のドラッグ結果を保存する。groupId と order だけを動かす。
  const applyReorder = async (updates: ReorderUpdate[]): Promise<boolean> => {
    if (!currentProject) return false
    const byId = new Map(updates.map((u) => [u.id, u]))
    const before = classes
    setClasses((prev) =>
      prev.map((c) => {
        const u = byId.get(c.id)
        return u ? { ...c, groupId: u.groupId, order: u.order } : c
      }),
    )
    try {
      const res = await fetch("/api/classes/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: currentProject.id, updates }),
      })
      if (!res.ok) { setClasses(before); return false }
      return true
    } catch {
      setClasses(before)
      return false
    }
  }

  // 整理（グループ・並び順）の書き込み。groupId を省いた分はサーバ側で現状のまま据え置く。
  // 確認履歴にも更新日時にも手を付けない（サーバ側も同じ方針）。
  const applyMoves = async (updates: { id: string; order: number; groupId?: string | null }[]) => {
    if (!currentProject || updates.length === 0) return
    const byId = new Map(updates.map((u) => [u.id, u]))
    const before = classes
    setMovingGroup(true)
    setClasses((prev) =>
      prev.map((c) => {
        const u = byId.get(c.id)
        if (!u) return c
        return u.groupId === undefined ? { ...c, order: u.order } : { ...c, order: u.order, groupId: u.groupId }
      }),
    )
    try {
      const res = await fetch("/api/classes/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: currentProject.id, updates }),
      })
      if (!res.ok) setClasses(before)
    } catch {
      setClasses(before)
    } finally {
      setMovingGroup(false)
    }
  }

  // 既に無いグループを指している分は「未分類」とみなす
  const normalizeGroup = (groupId?: string | null) =>
    groupId && groups.some((g) => g.id === groupId) ? groupId : null

  // 根クラスを、あるグループの中の指定位置へ置く（overId を省くと末尾）。
  // 並び順を持つのは根クラスだけ（サブクラスは親に従うので数に入れない）。
  const moveRootTo = (moved: OntologyClass, groupId: string | null, overId?: string) => {
    const roots = sortByOrder(
      classes.filter((c) => c.parentId === null && normalizeGroup(c.groupId) === groupId),
    )
    const { ordered, index } = placeAt(roots, moved, overId)
    applyMoves(reorderUpdates(ordered, index, groupId))
  }

  // 詳細ペインからの所属グループ変更。移動先グループの末尾に置く。
  const handleChangeGroup = (classId: string, groupId: string | null) => {
    const moved = classes.find((c) => c.id === classId)
    if (moved) moveRootTo(moved, groupId)
  }

  // 一覧表で、その行に落とせるか。
  //   継承（親子関係）は意味そのものなので、ドラッグでは変えない。
  //   よってサブクラスはきょうだいの間でしか動かせない。
  const canDropOn = (activeId: string, overId: string) => {
    const moved = classes.find((c) => c.id === activeId)
    if (!moved) return false
    // グループ見出し（＝そのグループの末尾へ）は根クラスだけ
    if (overId.startsWith(GROUP_ROW_PREFIX)) return moved.parentId === null
    const target = classes.find((c) => c.id === overId)
    if (!target) return false
    if (moved.parentId !== null) return moved.parentId === target.parentId
    // 自分の配下に落とすのは意味がない
    return rootOf(target, classById).id !== moved.id
  }

  // 一覧表で行を落としたとき。落とし先の行が「どの並びのどこか」を決める。
  const handleRowDrop = (activeId: string, overId: string) => {
    const moved = classes.find((c) => c.id === activeId)
    if (!moved) return

    // グループ見出しに落とした → そのグループの末尾へ
    if (overId.startsWith(GROUP_ROW_PREFIX)) {
      if (moved.parentId !== null) return
      const key = overId.slice(GROUP_ROW_PREFIX.length)
      moveRootTo(moved, key === "ungrouped" ? null : key)
      return
    }

    const target = classes.find((c) => c.id === overId)
    if (!target) return

    // サブクラス同士（同じ親）→ そのきょうだいの並びの中で入れ替える
    if (moved.parentId !== null && moved.parentId === target.parentId) {
      const siblings = sortByOrder(classes.filter((c) => c.parentId === moved.parentId))
      const { ordered, index } = placeAt(siblings, moved, overId)
      // グループは親に従うので送らない
      applyMoves(reorderUpdates(ordered, index, null).map(({ id, order }) => ({ id, order })))
      return
    }

    // 根クラス → 落とした行が属する木の根を目印に、その位置へ入れる（グループもそこに合わせる）
    if (moved.parentId === null) {
      const targetRoot = rootOf(target, classById)
      if (targetRoot.id === moved.id) return
      moveRootTo(moved, normalizeGroup(targetRoot.groupId), targetRoot.id)
    }
    // サブクラスを別の親の下へ落とすのは継承の変更なので、ここでは何もしない
  }

  // 選択中クラスの状態集計（ボタン表示制御用）
  const selectedStates = Array.from(selectedIds).map((id) => {
    const cls = classes.find((c) => c.id === id)
    return deriveConfirmationStatus(cls?.confirmations).state
  })
  // 未確認 or 確認済み* を含む → [確認する] を表示
  const canBulkConfirm = selectedStates.some((s) => s === "unconfirmed" || s === "confirmed_edited")
  // 確認済み or 確認済み* を含む → [確認を取り消す] を表示
  const canBulkUnconfirm = selectedStates.some((s) => s === "confirmed" || s === "confirmed_edited")

  // 一括確認: 未確認 と 確認済み* のみを対象に確認レコードを追加
  const handleBulkConfirm = async (confirmerName: string) => {
    const targets = Array.from(selectedIds).filter((id) => {
      const cls = classes.find((c) => c.id === id)
      const s = deriveConfirmationStatus(cls?.confirmations).state
      return s === "unconfirmed" || s === "confirmed_edited"
    })
    if (targets.length === 0) return
    setBulkConfirming(true)
    try {
      await Promise.all(
        targets.map((id) =>
          fetch(`/api/classes/${id}/confirmations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ confirmerName }),
          })
        )
      )
      await fetchClasses()
      setSelectedIds(new Set())
      setShowBulkConfirm(false)
    } finally {
      setBulkConfirming(false)
    }
  }

  // 一括取消: 確認済み と 確認済み* のみを対象に unconfirm を追加
  const handleBulkUnconfirm = async () => {
    const targets = Array.from(selectedIds).filter((id) => {
      const cls = classes.find((c) => c.id === id)
      const s = deriveConfirmationStatus(cls?.confirmations).state
      return s === "confirmed" || s === "confirmed_edited"
    })
    if (targets.length === 0) return
    setBulkUnconfirming(true)
    try {
      await Promise.all(
        targets.map((id) => fetch(`/api/classes/${id}/confirmations`, { method: "DELETE" }))
      )
      await fetchClasses()
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

  // 初回訪問（未選択）時は先頭のクラスを自動選択する。再訪問時は前回の選択を維持する
  useEffect(() => {
    if (loading || selectedId || flatClasses.length === 0) return
    // ボード表示は非選択のまま（全幅）で始める
    if (viewMode === "board") return
    setSelectedId(flatClasses[0].node.id)
  }, [loading, selectedId, flatClasses.length, viewMode])

  // 並べ替えは全件表示のときだけ。絞り込み中は隠れた行と入れ替わって挙動が読めなくなる。
  const canReorder = filterState === "all"
  // サブクラスも一緒に動くことがドラッグ中に分かるように、件数を添える
  const descendantCount = (id: string): number =>
    classes.filter((c) => c.parentId === id).reduce((n, c) => n + 1 + descendantCount(c.id), 0)
  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes])
  const selected = classes.find((c) => c.id === selectedId)
  // サブクラスのグループは親（根）に従う。表示も変更先もその根を見る。
  const selectedRoot = selected ? rootOf(selected, classById) : null
  const selectedGroup = groups.find((g) => g.id === (selectedRoot?.groupId ?? "")) ?? null
  const childClasses = selected ? classes.filter((c) => c.parentId === selected.id) : []
  const hasChildren = childClasses.length > 0
  const parentClass = selected?.parentId ? classes.find((c) => c.id === selected.parentId) : null
  const parentName = parentClass?.name ?? "なし"
  const directRelations = selected
    ? relations.filter((r) => r.classPairs.some((p) => p.sourceClassId === selected.id || p.targetClassId === selected.id))
    : []

  // 親クラスを遡って継承リレーションを収集する
  type InheritedRelRow = { relation: OntologyRelation; sourceClassId: string; targetClassId: string; inheritedFrom: OntologyClass }
  const inheritedRelations: InheritedRelRow[] = []
  if (selected) {
    const directIds = new Set(directRelations.map((r) => r.id))
    let ancestorId = selected.parentId
    while (ancestorId) {
      const ancestor = classes.find((c) => c.id === ancestorId)
      if (!ancestor) break
      for (const rel of relations) {
        if (directIds.has(rel.id)) continue
        for (const pair of rel.classPairs) {
          if (pair.sourceClassId === ancestor.id || pair.targetClassId === ancestor.id) {
            inheritedRelations.push({ relation: rel, sourceClassId: pair.sourceClassId, targetClassId: pair.targetClassId, inheritedFrom: ancestor })
            directIds.add(rel.id) // 同じリレーションを重複追加しない
          }
        }
      }
      ancestorId = ancestor.parentId
    }
  }

  const getClassName = (id: string) => classes.find((c) => c.id === id)?.name ?? "不明"

  // 変更があるか（保存ボタンの活性判定）
  const classDirty = !!selected && (
    editName !== selected.name ||
    editNameEn !== (selected.nameEn ?? "") ||
    editSynonyms.join("\n") !== (selected.synonyms ?? []).join("\n") ||
    editDesc !== (selected.description ?? "") ||
    (editParentId ?? null) !== (selected.parentId ?? null)
  )

  // 関連リレーション表のクラスセル（選択中クラスは強調、はみ出しは省略＋ホバーで全表示）
  const renderRelClassCell = (id: string) => {
    const name = getClassName(id)
    const isSelf = !!selected && id === selected.id
    return (
      <span
        title={name}
        className={cn(
          "block truncate",
          isSelf ? "font-semibold text-indigo-700 dark:text-indigo-300" : "text-foreground",
        )}
      >
        {name}
      </span>
    )
  }

  const parentCandidates = classes.filter((c) => c.parentId === null && c.id !== selectedId)
  const addParentCandidates = classes.filter((c) => c.parentId === null)

  // 属性セクションのレンダリング
  const renderAttrSection = (
    title: string,
    attrs: OntologyAttribute[],
    section: AttrSectionKey,
  ) => {
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

  const scopeWarningText = (section: AttrSectionKey): string | null => {
    if (section === "project") return "この属性はプロジェクト全体で共有されます。変更はすべてのクラスに影響します。"
    if (section === "parent") return `この属性は「${parentName}」クラスの属性です。変更はそのクラス全体に影響します。`
    return null
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar group="オントロジー設計" title="クラス管理">
        <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-transparent"
          onClick={handleExport} disabled={!currentProject || classes.length === 0 || exporting}>
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
              <h2 className="shrink-0 text-base font-semibold text-foreground">クラス一覧</h2>
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
              onClick={openAddDialog}>
              <Plus className="h-3.5 w-3.5" />クラスを追加
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
            {!canReorder && (
              <span className="text-muted-foreground">（絞り込み中は並べ替えできません）</span>
            )}
          </div>
          {selectedIds.size > 0 && (canBulkConfirm || canBulkUnconfirm) && (
            <div className="flex items-center gap-2 px-6 pb-3 text-xs">
              <span className="text-muted-foreground">{selectedIds.size}件を：</span>
              {canBulkConfirm && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 bg-transparent"
                  onClick={() => setShowBulkConfirm(true)}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  確認する
                </Button>
              )}
              {canBulkUnconfirm && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 bg-transparent"
                  onClick={handleBulkUnconfirm}
                  disabled={bulkUnconfirming}
                >
                  {bulkUnconfirming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                  確認を取り消す
                </Button>
              )}
            </div>
          )}
          <div className={cn("flex-1 px-6 pb-6", viewMode === "board" ? "min-h-0 overflow-hidden" : "overflow-auto")}>
            {loading && classes.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : flatClasses.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">
                {currentProject ? "クラスが登録されていません" : "プロジェクトを選択してください"}
              </p>
            ) : viewMode === "board" ? (
              <GroupBoard
                items={boardItems}
                groups={groups}
                selectedId={selectedId}
                onSelect={(id) => setSelectedId((prev) => (prev === id ? null : id))}
                onReorder={applyReorder}
              />
            ) : (
              <ListDndContext
                canDrop={canDropOn}
                onDrop={handleRowDrop}
                labelOf={(id) => {
                  const cls = classes.find((c) => c.id === id)
                  const n = descendantCount(id)
                  return (
                    <>
                      <span className="font-medium text-foreground">{cls?.name ?? id}</span>
                      {n > 0 && <span className="text-xs text-muted-foreground">＋サブクラス{n}件</span>}
                    </>
                  )
                }}
              >
              <div className="overflow-x-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="w-8" />
                      <TableHead className="w-10">
                        <input
                          type="checkbox"
                          aria-label="表示中のクラスをすべて選択"
                          checked={flatClasses.length > 0 && flatClasses.every(({ node }) => selectedIds.has(node.id))}
                          onChange={(e) => {
                            const next = new Set(selectedIds)
                            if (e.target.checked) flatClasses.forEach(({ node }) => next.add(node.id))
                            else flatClasses.forEach(({ node }) => next.delete(node.id))
                            setSelectedIds(next)
                          }}
                        />
                      </TableHead>
                      <TableHead className="font-semibold text-foreground">クラス名</TableHead>
                      <TableHead className="w-32 font-semibold text-foreground">確認</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {listRows.map((row) => {
                      if (row.kind === "group") {
                        return (
                          <DropRow key={row.key} id={row.key} enabled={canReorder} className="bg-muted/40 hover:bg-muted/40">
                            <TableCell colSpan={4} className="py-1.5">
                              <span className="flex items-center gap-2 text-xs font-semibold text-foreground">
                                <span
                                  className="h-2.5 w-2.5 rounded-full border border-border"
                                  style={row.group?.color ? { backgroundColor: row.group.color } : undefined}
                                />
                                {row.group?.name ?? "未分類"}
                                <span className="font-normal text-muted-foreground">{row.count}件</span>
                              </span>
                            </TableCell>
                          </DropRow>
                        )
                      }
                      const { node, depth } = row
                      const isSel = selectedId === node.id
                      const confirmStatus = deriveConfirmationStatus(node.confirmations)
                      const state = confirmStatus.state
                      const isChecked = selectedIds.has(node.id)
                      return (
                        <DragRow
                          key={row.key}
                          id={node.id}
                          label={node.name}
                          enabled={canReorder}
                          className={cn(
                            "cursor-pointer transition-colors",
                            isSel
                              ? "bg-indigo-100 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-950/50"
                              : "hover:bg-muted/50",
                          )}
                          onClick={() => setSelectedId(node.id)}
                        >
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              aria-label={`${node.name}を選択`}
                              checked={isChecked}
                              onChange={() => toggleSelect(node.id)}
                            />
                          </TableCell>
                          <TableCell className="font-medium text-foreground">
                            <span className="flex items-start" style={{ paddingLeft: depth * 16 }}>
                              {depth > 0 && <span className="mr-1 text-muted-foreground/70">└</span>}
                              <span className="flex flex-col">
                                <span>{node.name}</span>
                                {node.nameEn && <span className="text-xs font-normal text-muted-foreground">{node.nameEn}</span>}
                              </span>
                            </span>
                          </TableCell>
                          <TableCell>
                            <ConfirmationBadge state={state} latestConfirm={confirmStatus.latestConfirm} />
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

        {/* 詳細（常に編集可）。非選択のときは出さず、一覧・ボードを全幅にする */}
        {selected && (
          <div className="flex w-[30rem] shrink-0 flex-col overflow-hidden bg-card">
              <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
                {/* 基本情報 */}
                <section className="space-y-3">
                  <SectionHeader icon={FileText} title="基本情報" />
                  <div className="space-y-3">
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <ConfirmationSummary events={selected.confirmations} fieldLabels={CLASS_FIELD_LABEL} />
                      <p>登録日 {formatDateTime(selected.createdAt)}{selected.createdBy ? `（${selected.createdBy}）` : ""}</p>
                      <p>更新日 {formatDateTime(selected.updatedAt)}{selected.updatedBy ? `（${selected.updatedBy}）` : ""}</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">クラス名（日本語名） <span className="text-destructive">*</span></Label>
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)}
                        placeholder="例：不具合事例" className="h-8" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">クラス名（英語名）</Label>
                      <Input value={editNameEn} onChange={(e) => setEditNameEn(e.target.value)}
                        placeholder="例：Defect Case" className="h-8" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">同義語</Label>
                      <SynonymInput value={editSynonyms} onChange={setEditSynonyms} ownName={editName} />
                      <p className="text-xs text-muted-foreground">
                        文書中でこのクラスを指す別の呼び方。抽出時に読み替えます（例：商品クラスの「製品」→「製品名：アクトチェア」を商品として登録）
                      </p>
                      {saveError && <p className="text-xs text-destructive">{saveError}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">説明</Label>
                      <Textarea rows={4} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">親クラス</Label>
                      <Select
                        value={editParentId ?? "__none__"}
                        onValueChange={(v) => setEditParentId(v === "__none__" ? null : v)}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue>
                            {editParentId
                              ? (parentCandidates.find(c => c.id === editParentId)?.name ?? editParentId)
                              : "なし"}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent className="max-h-72">
                          <SelectItem value="__none__">なし</SelectItem>
                          {parentCandidates.map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">グループ</Label>
                      {selected.parentId ? (
                        // サブクラスは親と同じグループに置く。ここで個別に選ばせない
                        <>
                          <div className="flex h-8 items-center gap-2 rounded-lg border border-input bg-muted/40 px-2.5 text-sm text-foreground">
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full border border-border"
                              style={selectedGroup?.color ? { backgroundColor: selectedGroup.color } : undefined}
                            />
                            <span className="truncate">{selectedGroup?.name ?? "未分類"}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            サブクラスのグループは親クラス「{selectedRoot?.name}」に従います。変えるときは親クラスのグループを変えてください。
                          </p>
                        </>
                      ) : (
                        <>
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
                            一覧を見やすくするための整理用の区分です。オントロジーの意味やエクスポートには影響しません（選ぶと即座に保存され、配下のサブクラスも一緒に移ります）。
                          </p>
                        </>
                      )}
                    </div>
                  </div>
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
                      {selected.parentId && renderAttrSection(
                        `継承属性（${parentName}）`,
                        inheritedAttrs,
                        "parent"
                      )}
                      {renderAttrSection("クラス固有属性", ownAttrs, "own")}
                    </div>
                  )}
                </section>

                {/* 関連リレーション */}
                <section className="space-y-4">
                  <SectionHeader icon={Link2} title="関連リレーション" />
                  <div className="space-y-6">
                    {/* クラスが利用されているリレーション */}
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">クラスが利用されているリレーション</p>
                      <div className="rounded-lg border border-border">
                        <Table className="table-fixed">
                          <TableHeader>
                            <TableRow className="bg-muted/50 hover:bg-muted/50">
                              <TableHead className="w-[30%] font-semibold text-foreground">始点(A)クラス</TableHead>
                              <TableHead className="w-[40%] font-semibold text-foreground">リレーション名</TableHead>
                              <TableHead className="w-[30%] font-semibold text-foreground">終点(B)クラス</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {directRelations.length > 0 ? (
                              directRelations.flatMap((r) =>
                                r.classPairs
                                  .filter((p) => p.sourceClassId === selected!.id || p.targetClassId === selected!.id)
                                  .map((p, i) => (
                                    <TableRow key={`${r.id}-${i}`}>
                                      <TableCell>{renderRelClassCell(p.sourceClassId)}</TableCell>
                                      <TableCell className="font-medium text-foreground">
                                        <span title={r.name} className="block truncate">{r.name}</span>
                                      </TableCell>
                                      <TableCell>{renderRelClassCell(p.targetClassId)}</TableCell>
                                    </TableRow>
                                  ))
                              )
                            ) : (
                              <TableRow>
                                <TableCell colSpan={3} className="text-center text-muted-foreground">
                                  このクラスが使われているリレーションはありません
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </div>

                    {/* 継承されたリレーション */}
                    {inheritedRelations.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">継承されたリレーション</p>
                        <div className="rounded-lg border border-border">
                          <Table className="table-fixed">
                            <TableHeader>
                              <TableRow className="bg-muted/50 hover:bg-muted/50">
                                <TableHead className="w-[25%] font-semibold text-foreground">始点(A)クラス</TableHead>
                                <TableHead className="w-[30%] font-semibold text-foreground">リレーション名</TableHead>
                                <TableHead className="w-[25%] font-semibold text-foreground">終点(B)クラス</TableHead>
                                <TableHead className="w-[20%] font-semibold text-foreground">継承元クラス</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {inheritedRelations.map((row, i) => (
                                <TableRow key={`inh-${row.relation.id}-${i}`}>
                                  <TableCell>{renderRelClassCell(row.sourceClassId)}</TableCell>
                                  <TableCell className="font-medium text-foreground">
                                    <span title={row.relation.name} className="block truncate">{row.relation.name}</span>
                                  </TableCell>
                                  <TableCell>{renderRelClassCell(row.targetClassId)}</TableCell>
                                  <TableCell>
                                    <span title={row.inheritedFrom.name} className="block truncate text-sm text-muted-foreground">{row.inheritedFrom.name}</span>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    )}

                    {directRelations.length === 0 && inheritedRelations.length === 0 && (
                      <p className="text-center text-sm text-muted-foreground py-4">関連するリレーションはありません</p>
                    )}
                  </div>
                </section>
              </div>

              {/* フッター：削除・保存 */}
              <div className="flex items-center justify-between border-t border-border px-4 py-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={openDeleteDialog}
                >
                  <Trash2 className="h-3.5 w-3.5" />削除
                </Button>
                <Button size="sm" variant="success" onClick={handleSave} disabled={!editName.trim() || saving || !classDirty}>
                  {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}保存
                </Button>
              </div>
          </div>
        )}
      </div>

      {/* クラス追加ダイアログ */}
      <Dialog open={showAdd} onOpenChange={(o) => { setShowAdd(o); if (!o) setAddError(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>クラスを追加</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="cls-name">クラス名 <span className="text-destructive">*</span></Label>
              <Input id="cls-name" ref={newNameRef} value={newName} onChange={(e) => setNewName(e.target.value)}
                placeholder="例：不具合事例"
                onKeyDown={(e) => e.key === "Enter" && !adding && handleAdd(true)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cls-name-en">英語名</Label>
              <Input id="cls-name-en" value={newNameEn} onChange={(e) => setNewNameEn(e.target.value)}
                placeholder="例：Defect Case" />
            </div>
            <div className="space-y-2">
              <Label>同義語</Label>
              <SynonymInput value={newSynonyms} onChange={setNewSynonyms} ownName={newName} />
              {addError && <p className="text-xs text-destructive">{addError}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="cls-desc">説明</Label>
              <Textarea id="cls-desc" value={newDesc} onChange={(e) => setNewDesc(e.target.value)}
                rows={3} placeholder="クラスの定義・用途を記述" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cls-parent">親クラス</Label>
              <Select value={newParentId ?? "__none__"}
                onValueChange={(v) => setNewParentId(v === "__none__" ? null : v)}>
                <SelectTrigger id="cls-parent">
                  <SelectValue>
                    {newParentId
                      ? (addParentCandidates.find(c => c.id === newParentId)?.name ?? newParentId)
                      : "なし"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">なし</SelectItem>
                  {addParentCandidates.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {newParentId && (
                <p className="text-xs text-muted-foreground">
                  グループは親クラスと同じになります。Enter または［続けて追加］で、親を変えずに次のサブクラスを続けて登録できます。
                </p>
              )}
            </div>
            {addedNames.length > 0 && (
              <p className="rounded-md bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground">
                追加済み（{addedNames.length}件）：{addedNames.join("、")}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>
              {addedNames.length > 0 ? "閉じる" : "キャンセル"}
            </Button>
            <Button variant="outline" onClick={() => handleAdd(true)} disabled={!newName.trim() || adding}>
              {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              続けて追加
            </Button>
            <Button onClick={() => handleAdd(false)} disabled={!newName.trim() || adding}>
              {adding ? "登録中..." : "登録して閉じる"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 属性追加ダイアログ */}
      <Dialog open={showAddAttr} onOpenChange={setShowAddAttr}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>属性を追加</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {addAttrSection !== "own" && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {addAttrSection === "project"
                    ? "プロジェクト全体の共通属性として追加されます。全クラスに適用されます。"
                    : `「${parentName}」クラスへ追加されます。そのクラス全体に影響します。`}
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="attr-name">属性名 <span className="text-destructive">*</span></Label>
              <Input id="attr-name" value={attrName} onChange={(e) => setAttrName(e.target.value)}
                placeholder="例：登録日" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="attr-desc">説明</Label>
              <Textarea id="attr-desc" rows={2} value={attrDesc}
                onChange={(e) => setAttrDesc(e.target.value)}
                placeholder="属性の意味・用途を記述" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="attr-dtype">データ型</Label>
              <Select value={attrDataType} onValueChange={(v) => { if (v) setAttrDataType(v) }}>
                <SelectTrigger id="attr-dtype">
                  <SelectValue>{attrDataType}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {["文字列", "数値", "日付", "真偽値"].map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="attr-req">必須／任意</Label>
              <Select value={attrRequired} onValueChange={(v) => setAttrRequired(v as AttributeRequired)}>
                <SelectTrigger id="attr-req">
                  <SelectValue>{attrRequired}</SelectValue>
                </SelectTrigger>
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
          <DialogHeader>
            <DialogTitle>属性を編集</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {editAttrSection !== "own" && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {scopeWarningText(editAttrSection)}
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="edit-attr-name">属性名 <span className="text-destructive">*</span></Label>
              <Input id="edit-attr-name" value={editAttrName}
                onChange={(e) => setEditAttrName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-attr-desc">説明</Label>
              <Textarea id="edit-attr-desc" rows={2} value={editAttrDesc}
                onChange={(e) => setEditAttrDesc(e.target.value)}
                placeholder="属性の意味・用途を記述" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-attr-dtype">データ型</Label>
              <Select value={editAttrDataType} onValueChange={(v) => { if (v) setEditAttrDataType(v) }}>
                <SelectTrigger id="edit-attr-dtype">
                  <SelectValue>{editAttrDataType}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {["文字列", "数値", "日付", "真偽値"].map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-attr-req">必須／任意</Label>
              <Select value={editAttrRequired} onValueChange={(v) => setEditAttrRequired(v as AttributeRequired)}>
                <SelectTrigger id="edit-attr-req">
                  <SelectValue>{editAttrRequired}</SelectValue>
                </SelectTrigger>
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

      {/* スコープ警告確認ダイアログ（削除時） */}
      <Dialog open={showScopeAlert} onOpenChange={setShowScopeAlert}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {scopeAlertIsWarning && <AlertTriangle className="h-5 w-5 text-amber-500" />}
              {scopeAlertIsWarning ? "影響範囲の確認" : "削除の確認"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{scopeAlertMsg}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowScopeAlert(false); setPendingAction(null) }}>
              キャンセル
            </Button>
            <Button variant="destructive" onClick={() => {
              setShowScopeAlert(false)
              pendingAction?.fn()
              setPendingAction(null)
            }}>
              削除する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* クラス削除確認ダイアログ */}
      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>「{selected?.name}」を削除</DialogTitle>
          </DialogHeader>

          {loadingDeleteInfo ? (
            <div className="flex items-center justify-center py-4 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />確認中…
            </div>
          ) : (
            <div className="space-y-5 py-1">
              {selected && deriveConfirmationStatus(selected.confirmations).state !== "unconfirmed" && (
                <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive">
                  このクラスは確認済みです。本当に削除しますか？
                </p>
              )}
              {/* 子クラスの処理 */}
              {hasChildren && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">
                    子クラスの扱い
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      （{childClasses.length}件）
                    </span>
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {(["promote", "cascade"] as const).map((mode) => (
                      <label key={mode} className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
                        <input
                          type="radio"
                          name="childMode"
                          value={mode}
                          checked={deleteChildMode === mode}
                          onChange={() => setDeleteChildMode(mode)}
                          className="accent-foreground"
                        />
                        {mode === "promote" ? "親なしで残す" : "一緒に削除"}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* インスタンスの処理 */}
              {deleteInstanceCount > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">
                    インスタンスの扱い
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      （{deleteInstanceCount}件）
                    </span>
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {(["unclassify", "delete"] as const).map((mode) => (
                      <label key={mode} className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
                        <input
                          type="radio"
                          name="instanceMode"
                          value={mode}
                          checked={deleteInstanceMode === mode}
                          onChange={() => setDeleteInstanceMode(mode)}
                          className="accent-foreground"
                        />
                        {mode === "unclassify" ? "未分類として残す" : "一緒に削除"}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {!hasChildren && deleteInstanceCount === 0 && (
                <p className="text-sm text-muted-foreground">
                  この操作は取り消せません。
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)} disabled={deleting}>
              キャンセル
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting || loadingDeleteInfo}>
              {deleting ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" />処理中…</> : "削除する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* クラス定義インポート */}
      {currentProject && (
        <GroupManagerDialog
          open={showGroupManager}
          onOpenChange={setShowGroupManager}
          projectId={currentProject.id}
          target="class"
          groups={groups}
          onSaved={(saved) => {
            setGroups(saved)
            // 削除されたグループを指していたクラスは未分類に戻る（サーバ側で groupId を外す）
            fetchClasses()
          }}
        />
      )}

      <ImportDialog<ClassExportItem>
        open={showImport}
        onOpenChange={setShowImport}
        title="クラス定義をインポート"
        entityLabel="クラス"
        replaceNote="紐づくインスタンスは削除せず未分類になります。"
        parse={parseClassesYaml}
        preview={(items, mode) => previewClassesImport(items, classes, mode)}
        onExecute={async (items, mode) => {
          if (!currentProject) throw new Error("プロジェクトが選択されていません")
          const result = await executeClassesImport(currentProject.id, items, classes, mode)
          return {
            created: result.created,
            updated: result.updated,
            deleted: result.deleted,
            note: result.unclassifiedInstances > 0
              ? `未分類にしたインスタンス: ${result.unclassifiedInstances}件`
              : undefined,
          }
        }}
        onImported={async () => {
          setSelectedId(null)
          await fetchClasses()
        }}
      />

      {/* 一括確認ダイアログ */}
      <ConfirmDialog
        open={showBulkConfirm}
        onOpenChange={setShowBulkConfirm}
        title={`選択した${selectedIds.size}件のクラスを確認する`}
        description="選択したすべてのクラスに同一の確認レコードが追加されます。"
        submitting={bulkConfirming}
        onSubmit={handleBulkConfirm}
      />
    </div>
  )
}
