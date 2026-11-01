"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
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
import { DragRow, DropRow, ListDndContext } from "@/components/list-dnd"
import { SectionHeader } from "@/components/section-header"
import { AttrValueList, hasMissingRequired } from "@/components/attr-fields"
import { ConditionValueList, hasIncompleteConditions } from "@/components/condition-fields"
import { cn } from "@/lib/utils"
import { classMap, isSelfOrDescendant } from "@/lib/relation-inherit"
import { useProject } from "@/app/project-context"
import { isRegistered } from "@/lib/instance-status"
import { groupBy, runWithConcurrency } from "@/lib/concurrency"
import { orderBetween, placeAt, renumber, sortByOrder } from "@/lib/organize"
import { buildCypher } from "@/lib/graph-export"
import type { Triplet, ClassTriplet, OntologyInstance, OntologyRelation, OntologyClass, OntologyAttribute, TripletConditions } from "@/lib/types"
import { ArrowRight, Plus, Trash2, Loader2, Download, FileText, Tags, SlidersHorizontal, CheckCircle2, X, ChevronDown, ChevronRight } from "lucide-react"
import { deriveConfirmationStatus, type ConfirmationState } from "@/lib/confirmation"
import type { ConfirmationEvent } from "@/lib/types"
import { ConfirmationBadge } from "@/components/confirmation-badge"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { ConfirmationSummary } from "@/components/confirmation-summary"

// 見出しの行id。トリプレットのidと混ざらないように印を付ける。
const SECTION_ROW_PREFIX = "sec:"
const GROUP_ROW_PREFIX = "group:"

// 一覧の節。主語・目的語がクラス(c)かインスタンス(i)かの4通り。
// どの節も同じ列・同じ見た目で出し、中身の違いは見出しの説明で伝える。
type Pattern = "ii" | "ic" | "ci" | "cc"
const PATTERNS: { key: Pattern; label: string; note: string }[] = [
  {
    key: "ii",
    label: "インスタンス → インスタンス",
    note: "個別のものどうしの関係です。文書から抽出したトリプレットもここに入ります。",
  },
  {
    key: "ic",
    label: "インスタンス → クラス",
    note: "その個別のものが、相手クラスのいずれかと関係します（相手がまだ特定できていない言明）。",
  },
  {
    key: "ci",
    label: "クラス → インスタンス",
    note: "そのクラスのインスタンスすべてが、特定の相手と関係します。子クラスにも継承されます。",
  },
  {
    key: "cc",
    label: "クラス → クラス",
    note: "そのクラスのものは、相手クラスのいずれかと関係します。子クラスにも継承されます。",
  },
]

// 一覧の1行。インスタンス同士のトリプレットと、クラスを含むトリプレットを
// 同じ形に均して扱う（表示も並べ替えも4つの節で揃えるため）。
type AnyRow = {
  id: string
  pattern: Pattern
  predicateRelationId: string
  order?: number
  createdAt?: string
  subjectKind: EndKind
  subjectLabel: string
  subjectTitle: string
  predicateLabel: string
  objectKind: EndKind
  objectLabel: string
  objectTitle: string
  sourceDocName?: string
  confirmations?: ConfirmationEvent[]
}

const TRIPLET_FIELD_LABEL: Record<string, string> = {
  subjectInstanceId: "主語",
  predicateRelationId: "述語",
  objectInstanceId: "目的語",
  subjectName: "主語名",
  predicateName: "述語名",
  objectName: "目的語名",
  attributes: "属性",
}

function formatDateTime(iso: string | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
}

type Draft = { subjectInstanceId: string; predicateRelationId: string; objectInstanceId: string }
const EMPTY_DRAFT: Draft = { subjectInstanceId: "", predicateRelationId: "", objectInstanceId: "" }

// 追加ダイアログの下書き。リレーションは親クラスで定義し、インスタンスは子クラスに
// ぶら下がるので、同じ述語・同じ相手のトリプレットが件数分必要になることが多い。
// そのため主語・目的語は複数選べるようにして、組み合わせをまとめて登録する。
// 追加ダイアログの下書き。主語・目的語それぞれクラスかインスタンスかを選べるので、
// 4通り（インスタンス→インスタンス／クラス→インスタンス／クラス→クラス／
// インスタンス→クラス）をこの1つのダイアログで作れる。
// どちらも複数選べて、組み合わせをまとめて登録する。
type EndKind = "class" | "instance"
type AddDraft = {
  predicateRelationId: string
  subjectKind: EndKind
  subjectIds: string[]
  objectKind: EndKind
  objectIds: string[]
}
const EMPTY_ADD: AddDraft = {
  predicateRelationId: "",
  subjectKind: "instance",
  subjectIds: [],
  objectKind: "instance",
  objectIds: [],
}

export function TripletsScreen({ active }: { active?: boolean }) {
  const { currentProject, loading: projectLoading } = useProject()
  const [triplets, setTriplets] = useState<Triplet[]>([])
  const [instances, setInstances] = useState<OntologyInstance[]>([])
  const [relations, setRelations] = useState<OntologyRelation[]>([])
  const [classes, setClasses] = useState<OntologyClass[]>([])
  // クラストリプレット（主語がクラス）。インスタンスのトリプレットとは別に持つ。
  const [classTriplets, setClassTriplets] = useState<ClassTriplet[]>([])
  const [deletingClassTripletId, setDeletingClassTripletId] = useState<string | null>(null)
  const [confirmClassTripletId, setConfirmClassTripletId] = useState<string | null>(null)
  const [confirmingClassTriplet, setConfirmingClassTriplet] = useState(false)
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // 追加ダイアログ
  const [showAdd, setShowAdd] = useState(false)
  const [addDraft, setAddDraft] = useState<AddDraft>(EMPTY_ADD)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  // 右ペイン編集
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT)
  // クラスを含むトリプレットの編集下書き（端の種類も変えられる）
  type ClassDraft = {
    subjectKind: EndKind
    subjectId: string
    predicateRelationId: string
    objectKind: EndKind
    objectId: string
  }
  const EMPTY_CLASS_DRAFT: ClassDraft = {
    subjectKind: "class", subjectId: "", predicateRelationId: "", objectKind: "class", objectId: "",
  }
  const [editClassDraft, setEditClassDraft] = useState<ClassDraft>(EMPTY_CLASS_DRAFT)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // 削除
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Neo4jエクスポート
  const [showExport, setShowExport] = useState(false)

  // 一覧の見せ方：述語のリレーションごとにまとめるか、1本の並びで出すか
  const [groupByRelation, setGroupByRelation] = useState(true)
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<Set<string>>(new Set())
  const [movingOrder, setMovingOrder] = useState(false)

  // 確認機構
  const [filterState, setFilterState] = useState<"all" | ConfirmationState>("all")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showBulkConfirm, setShowBulkConfirm] = useState(false)
  const [bulkConfirming, setBulkConfirming] = useState(false)
  const [bulkUnconfirming, setBulkUnconfirming] = useState(false)

  // 述語リレーションごとの属性定義（プロジェクト共通＋リレーション固有）のキャッシュ。
  // トリプレット（エッジ）に属性値を入力させるために、選択中の述語の属性を読み込む。
  const [attrsByRelation, setAttrsByRelation] = useState<Record<string, OntologyAttribute[]>>({})
  const [loadingAttrs, setLoadingAttrs] = useState(false)
  // 追加ダイアログ／編集ペインそれぞれの属性値（キー＝属性id）
  const [addAttrValues, setAddAttrValues] = useState<Record<string, string>>({})
  const [editAttrValues, setEditAttrValues] = useState<Record<string, string>>({})
  // 成立条件の値（キー＝リレーションが宣言した条件項目の id）
  const [addConditions, setAddConditions] = useState<TripletConditions>({})
  const [editConditions, setEditConditions] = useState<TripletConditions>({})

  const registeredInstances = useMemo(
    () => instances.filter((i) => isRegistered(i)).sort((a, b) => a.name.localeCompare(b.name, "ja")),
    [instances],
  )
  const classNameById = useMemo(() => new Map(classes.map((c) => [c.id, c.name])), [classes])
  const instById = useMemo(() => new Map(instances.map((i) => [i.id, i])), [instances])
  const relById = useMemo(() => new Map(relations.map((r) => [r.id, r])), [relations])
  // 述語に選んだリレーションが宣言している条件項目（具体値はトリプレット側で入れる）
  const slotsOf = (relationId: string) => relById.get(relationId)?.conditions ?? []
  const className = (id: string | null) => (id ? (classNameById.get(id) ?? "不明") : "未分類")

  const fetchAll = useCallback(async () => {
    if (!currentProject) return
    setLoading(true)
    try {
      const [t, i, r, c, ct] = await Promise.all([
        fetch(`/api/triplets?projectId=${currentProject.id}`).then((res) => res.json()),
        fetch(`/api/instances?projectId=${currentProject.id}`).then((res) => res.json()),
        fetch(`/api/relations?projectId=${currentProject.id}`).then((res) => res.json()),
        fetch(`/api/classes?projectId=${currentProject.id}`).then((res) => res.json()),
        fetch(`/api/class-triplets?projectId=${currentProject.id}`).then((res) => res.json()),
      ])
      setTriplets(Array.isArray(t) ? t : [])
      setInstances(Array.isArray(i) ? i : [])
      setRelations(Array.isArray(r) ? r : [])
      setClasses(Array.isArray(c) ? c : [])
      setClassTriplets(Array.isArray(ct) ? ct : [])
    } finally {
      setLoading(false)
    }
  }, [currentProject?.id])

  // プロジェクト切替時のみデータを捨てる。取得は下の表示時 effect に任せる。
  useEffect(() => {
    if (projectLoading) return
    setTriplets([]); setInstances([]); setRelations([]); setClasses([]); setClassTriplets([]); setSelectedId(null)
    setLoading(!!currentProject)
  }, [currentProject?.id, projectLoading])

  useEffect(() => {
    if (active && currentProject) fetchAll()
  }, [active, currentProject?.id, fetchAll])

  // 述語リレーションの属性定義（プロジェクト共通＋リレーション固有）を読み込む（キャッシュ）。
  const ensureRelAttrs = useCallback(async (relationId: string) => {
    if (!relationId || !currentProject) return
    if (attrsByRelation[relationId]) return
    setLoadingAttrs(true)
    try {
      const [projData, ownData] = await Promise.all([
        fetch(`/api/attributes?targetId=${currentProject.id}`).then((r) => r.json()),
        fetch(`/api/attributes?targetId=${relationId}`).then((r) => r.json()),
      ])
      const combined = [
        ...(Array.isArray(projData) ? projData : []),
        ...(Array.isArray(ownData) ? ownData : []),
      ]
      setAttrsByRelation((prev) => ({ ...prev, [relationId]: combined }))
    } finally {
      setLoadingAttrs(false)
    }
  }, [currentProject?.id, attrsByRelation])

  const selected = triplets.find((t) => t.id === selectedId) ?? null
  // クラスを含むトリプレットも同じ一覧から選べる（右ペインは読み取り専用で出す）
  const selectedClassTriplet = classTriplets.find((c) => c.id === selectedId) ?? null

  // ── 一覧の組み立て ──
  // 主語・目的語がクラスかインスタンスかの4通りで節に分ける。見た目は4つとも同じにする。
  const rows: AnyRow[] = useMemo(() => {
    const fromTriplet = (t: Triplet): AnyRow => ({
      id: t.id,
      pattern: "ii",
      predicateRelationId: t.predicateRelationId,
      order: t.order,
      createdAt: t.createdAt,
      subjectKind: "instance",
      subjectLabel: t.subjectName,
      subjectTitle: `クラス：${className(t.subjectClassId)}`,
      predicateLabel: t.predicateName,
      objectKind: "instance",
      objectLabel: t.objectName,
      objectTitle: `クラス：${className(t.objectClassId)}`,
      sourceDocName: t.sourceDocName,
      confirmations: t.confirmations,
    })
    const fromClassTriplet = (ct: ClassTriplet): AnyRow => ({
      id: ct.id,
      pattern: `${ct.subjectKind === "class" ? "c" : "i"}${ct.objectKind === "class" ? "c" : "i"}` as Pattern,
      predicateRelationId: ct.predicateRelationId,
      order: ct.order,
      createdAt: ct.createdAt,
      subjectKind: ct.subjectKind,
      subjectLabel:
        (ct.subjectKind === "class" ? classNameById.get(ct.subjectId) : instById.get(ct.subjectId)?.name) ??
        ct.subjectName,
      subjectTitle: ct.subjectKind === "class" ? "クラス" : "インスタンス",
      predicateLabel: relById.get(ct.predicateRelationId)?.name ?? ct.predicateName,
      objectKind: ct.objectKind,
      objectLabel:
        (ct.objectKind === "class" ? classNameById.get(ct.objectId) : instById.get(ct.objectId)?.name) ??
        ct.objectName,
      objectTitle: ct.objectKind === "class" ? "クラス" : "インスタンス",
      confirmations: ct.confirmations,
    })
    return [...triplets.map(fromTriplet), ...classTriplets.map(fromClassTriplet)]
  }, [triplets, classTriplets, classNameById, instById, relById])

  // 表示中の行（確認状態フィルタ）。並びは order（未設定は末尾）。
  const displayedRows = useMemo(() => {
    const base = filterState === "all"
      ? rows
      : rows.filter((r) => deriveConfirmationStatus(r.confirmations).state === filterState)
    return sortByOrder(base)
  }, [rows, filterState])

  const rowById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows])

  // 並べ替えは全件表示のときだけ。絞り込み中は隠れた行と入れ替わって挙動が読めなくなる。
  const canReorder = filterState === "all"

  const toggleGroupKey = (key: string) =>
    setCollapsedGroupKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  type ListRow =
    | { kind: "section"; key: string; pattern: Pattern; label: string; note: string; count: number }
    | { kind: "group"; key: string; groupKey: string; label: string; count: number }
    | { kind: "row"; key: string; row: AnyRow }

  // 4つの節を必ず出す（0件の節も「ここには無い」と分かるように見出しだけ出す）。
  // 節の中は、まとめ方に応じて述語のリレーションごとにさらに分ける。
  const listRows: ListRow[] = useMemo(() => {
    return PATTERNS.flatMap(({ key, label, note }) => {
      const items = displayedRows.filter((r) => r.pattern === key)
      const head: ListRow = { kind: "section", key: `${SECTION_ROW_PREFIX}${key}`, pattern: key, label, note, count: items.length }
      if (collapsedGroupKeys.has(key) || items.length === 0) return [head]
      if (!groupByRelation) {
        return [head, ...items.map((row) => ({ kind: "row" as const, key: row.id, row }))]
      }
      const buckets = new Map<string, AnyRow[]>()
      for (const r of items) {
        const list = buckets.get(r.predicateRelationId)
        if (list) list.push(r)
        else buckets.set(r.predicateRelationId, [r])
      }
      const known = sortByOrder(relations).map((r) => r.id)
      const rest = [...buckets.keys()].filter((id) => !known.includes(id)).sort()
      const body = [...known, ...rest].flatMap((relationId) => {
        const list = buckets.get(relationId) ?? []
        if (list.length === 0) return [] as ListRow[]
        const groupKey = `${key}/${relationId}`
        return [
          {
            kind: "group" as const,
            key: `${GROUP_ROW_PREFIX}${groupKey}`,
            groupKey,
            label: relById.get(relationId)?.name ?? list[0].predicateLabel ?? "（定義なし）",
            count: list.length,
          },
          ...(collapsedGroupKeys.has(groupKey)
            ? []
            : list.map((row) => ({ kind: "row" as const, key: row.id, row }))),
        ]
      })
      return [head, ...body]
    })
  }, [displayedRows, groupByRelation, relations, relById, collapsedGroupKeys])

  // 並び順の書き込み。前後に隙間があればその1件だけ、尽きていたら並び全体を振り直す。
  // order は整理の都合なので、確認履歴にも更新日時にも手を付けない（サーバ側も同じ方針）。
  const applyOrder = async (pattern: Pattern, ordered: AnyRow[], index: number) => {
    if (!currentProject) return
    const unnumbered = ordered.some((r) => r.order === undefined)
    const between = unnumbered ? null : orderBetween(ordered[index - 1], ordered[index + 1])
    const updates = between === null ? renumber(ordered) : [{ id: ordered[index].id, order: between }]
    const byId = new Map(updates.map((u) => [u.id, u.order]))
    const toInstances = pattern === "ii"
    const beforeT = triplets
    const beforeC = classTriplets
    setMovingOrder(true)
    if (toInstances) setTriplets((prev) => prev.map((t) => (byId.has(t.id) ? { ...t, order: byId.get(t.id) } : t)))
    else setClassTriplets((prev) => prev.map((c) => (byId.has(c.id) ? { ...c, order: byId.get(c.id) } : c)))
    try {
      const res = await fetch(toInstances ? "/api/triplets/reorder" : "/api/class-triplets/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: currentProject.id, updates }),
      })
      if (!res.ok) { setTriplets(beforeT); setClassTriplets(beforeC) }
    } catch {
      setTriplets(beforeT); setClassTriplets(beforeC)
    } finally {
      setMovingOrder(false)
    }
  }

  // 落とし先の行が属する並び（まとめているときは同じ述語の中だけ）
  const siblingsOf = (r: AnyRow) =>
    displayedRows.filter(
      (x) => x.pattern === r.pattern && (!groupByRelation || x.predicateRelationId === r.predicateRelationId),
    )

  // 節をまたぐ移動と、述語の違う行への移動は認めない。
  // どちらも並べ替えではなく「作り直し」にあたるので、ドラッグで変わってしまわないようにする。
  const lotOfRow = (rowId: string): string | null => {
    if (rowId.startsWith(SECTION_ROW_PREFIX)) {
      const pattern = rowId.slice(SECTION_ROW_PREFIX.length)
      return groupByRelation ? null : pattern
    }
    if (rowId.startsWith(GROUP_ROW_PREFIX)) return groupByRelation ? rowId.slice(GROUP_ROW_PREFIX.length) : null
    const r = rowById.get(rowId)
    if (!r) return null
    return groupByRelation ? `${r.pattern}/${r.predicateRelationId}` : r.pattern
  }

  const canDropRow = (activeId: string, overId: string) => {
    const a = lotOfRow(activeId)
    return a !== null && a === lotOfRow(overId)
  }

  // 一覧表で行を落としたとき。見出しならその末尾、行ならその位置へ入れる。
  const handleRowDrop = (activeId: string, overId: string) => {
    const moved = rowById.get(activeId)
    if (!moved || !canDropRow(activeId, overId)) return
    const list = siblingsOf(moved)
    const target = rowById.get(overId)
    const { ordered, index } = placeAt(list, moved, target?.id)
    applyOrder(moved.pattern, ordered, index)
  }

  // クラスを含むトリプレットは別のコンテナなので、行ごとに送り先を変える
  const confirmEndpoint = (id: string) =>
    rowById.get(id)?.pattern === "ii" ? `/api/triplets/${id}/confirmations` : `/api/class-triplets/${id}/confirmations`

  const confirmSelectedStates = Array.from(selectedIds).map((id) =>
    deriveConfirmationStatus(rowById.get(id)?.confirmations).state,
  )
  const canBulkConfirm = confirmSelectedStates.some((s) => s === "unconfirmed" || s === "confirmed_edited")
  const canBulkUnconfirm = confirmSelectedStates.some((s) => s === "confirmed" || s === "confirmed_edited")

  const handleBulkConfirm = async (confirmerName: string) => {
    const targets = Array.from(selectedIds).filter((id) => {
      const s = deriveConfirmationStatus(rowById.get(id)?.confirmations).state
      return s === "unconfirmed" || s === "confirmed_edited"
    })
    if (targets.length === 0) return
    setBulkConfirming(true)
    try {
      await Promise.all(
        targets.map((id) =>
          fetch(confirmEndpoint(id), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ confirmerName }),
          })
        )
      )
      await fetchAll()
      setSelectedIds(new Set())
      setShowBulkConfirm(false)
    } finally {
      setBulkConfirming(false)
    }
  }

  const handleBulkUnconfirm = async () => {
    const targets = Array.from(selectedIds).filter((id) => {
      const s = deriveConfirmationStatus(rowById.get(id)?.confirmations).state
      return s === "confirmed" || s === "confirmed_edited"
    })
    if (targets.length === 0) return
    setBulkUnconfirming(true)
    try {
      await Promise.all(
        targets.map((id) => fetch(confirmEndpoint(id), { method: "DELETE" }))
      )
      await fetchAll()
      setSelectedIds(new Set())
    } finally {
      setBulkUnconfirming(false)
    }
  }

  const toggleSelectConfirm = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // 選択が変わったら編集フィールドを対象トリプレットで初期化
  useEffect(() => {
    if (selected) {
      setEditDraft({
        subjectInstanceId: selected.subjectInstanceId,
        predicateRelationId: selected.predicateRelationId,
        objectInstanceId: selected.objectInstanceId,
      })
      setEditAttrValues(selected.attributes ?? {})
      setEditConditions(selected.conditions ?? {})
      if (selected.predicateRelationId) ensureRelAttrs(selected.predicateRelationId)
      setSaveError(null)
    }
    if (selectedClassTriplet) {
      setEditClassDraft({
        subjectKind: selectedClassTriplet.subjectKind,
        subjectId: selectedClassTriplet.subjectId,
        predicateRelationId: selectedClassTriplet.predicateRelationId,
        objectKind: selectedClassTriplet.objectKind,
        objectId: selectedClassTriplet.objectId,
      })
      setEditConditions(selectedClassTriplet.conditions ?? {})
      setSaveError(null)
    }
  }, [selectedId])

  // 未選択時は先頭を自動選択（インスタンス同士が無ければクラスを含む分から）
  useEffect(() => {
    if (loading || selectedId) return
    const first = triplets[0]?.id ?? classTriplets[0]?.id
    if (first) setSelectedId(first)
  }, [loading, selectedId, triplets.length, classTriplets.length])

  // 3要素すべて選択済みか（保存/追加の活性判定）。クラスペアの整合はサーバが検証し、
  // 不整合ならエラーを返す（前設計の整合表示は廃止）。
  const isComplete = (d: Draft) => !!(d.subjectInstanceId && d.predicateRelationId && d.objectInstanceId)

  // クラスを端に使えるので、インスタンスが2件なくても作れる
  const noPrereq = relations.length === 0 || classes.length === 0

  const openAdd = () => { setAddDraft(EMPTY_ADD); setAddAttrValues({}); setAddConditions({}); setAddError(null); setShowAdd(true) }

  // 端（クラス or インスタンス）を型として見るときのクラスid
  const classIdOfEnd = (kind: EndKind, id: string) => (kind === "class" ? id : instById.get(id)?.classId ?? null)
  const bothInstance = addDraft.subjectKind === "instance" && addDraft.objectKind === "instance"

  const tripletKeyOf = (s: string, p: string, o: string) => `${s}|${p}|${o}`
  const existingTripletKeys = useMemo(
    () => new Set(triplets.map((t) => tripletKeyOf(t.subjectInstanceId, t.predicateRelationId, t.objectInstanceId))),
    [triplets],
  )
  // 主語×目的語の総当たり。自分自身への関係と、既に登録済みの組み合わせは省く。
  const classTripletKeys = useMemo(
    () => new Set(classTriplets.map((c) => tripletKeyOf(c.subjectId, c.predicateRelationId, c.objectId))),
    [classTriplets],
  )
  // 主語×目的語の総当たり。同じものどうしと、既に登録済みの組み合わせは省く。
  const addCombos = useMemo(() => {
    const { predicateRelationId: rel, subjectKind, subjectIds, objectKind, objectIds } = addDraft
    if (!rel) return [] as { subjectId: string; objectId: string }[]
    const known = subjectKind === "instance" && objectKind === "instance" ? existingTripletKeys : classTripletKeys
    const out: { subjectId: string; objectId: string }[] = []
    for (const subjectId of subjectIds)
      for (const objectId of objectIds) {
        if (subjectKind === objectKind && subjectId === objectId) continue
        if (known.has(tripletKeyOf(subjectId, rel, objectId))) continue
        out.push({ subjectId, objectId })
      }
    return out
  }, [addDraft, existingTripletKeys, classTripletKeys])
  // 総当たりのうち、既に登録済みで省いた件数（登録済みであることを伝えるため）
  const addSkipped = useMemo(() => {
    const { subjectKind, subjectIds, objectKind, objectIds } = addDraft
    const all = subjectIds.length * objectIds.length
    const selfPairs = subjectKind === objectKind ? subjectIds.filter((id) => objectIds.includes(id)).length : 0
    return all - selfPairs - addCombos.length
  }, [addDraft, addCombos])

  // 追加／編集で述語が変わったら、その述語リレーションの属性定義を読み込む
  useEffect(() => { if (addDraft.predicateRelationId) ensureRelAttrs(addDraft.predicateRelationId) }, [addDraft.predicateRelationId, ensureRelAttrs])
  // 述語が変われば条件項目も変わるので、入れていた値は持ち越さない
  useEffect(() => { setAddConditions({}) }, [addDraft.predicateRelationId])
  useEffect(() => { if (editDraft.predicateRelationId) ensureRelAttrs(editDraft.predicateRelationId) }, [editDraft.predicateRelationId, ensureRelAttrs])

  // 指定リレーションに定義された属性のうち、値が入っているものだけを {id: value} で返す
  const collectAttrValues = (relationId: string, values: Record<string, string>): Record<string, string> => {
    const attrs = attrsByRelation[relationId] ?? []
    const out: Record<string, string> = {}
    for (const a of attrs) {
      const v = (values[a.id] ?? "").trim()
      if (v !== "") out[a.id] = values[a.id]
    }
    return out
  }

  // 選んだ組み合わせをまとめて登録する。属性は全件に同じ値を入れる。
  // 主語も目的語もインスタンスならインスタンストリプレット、
  // どちらかがクラスならクラスを含むトリプレットとして保存する。
  const handleAdd = async () => {
    if (!currentProject || addCombos.length === 0) return
    setAdding(true); setAddError(null)
    const { predicateRelationId, subjectKind, objectKind } = addDraft
    const toInstances = subjectKind === "instance" && objectKind === "instance"
    const attributes = collectAttrValues(predicateRelationId, addAttrValues)
    // 選んだ組み合わせ全件に同じ条件を入れる（属性と同じ扱い）
    const conditions = addConditions
    let created = 0
    const errors: string[] = []
    const jobs = addCombos.map((combo) => async () => {
      try {
        const res = await fetch(toInstances ? "/api/triplets" : "/api/class-triplets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            toInstances
              ? {
                  projectId: currentProject.id,
                  subjectInstanceId: combo.subjectId,
                  predicateRelationId,
                  objectInstanceId: combo.objectId,
                  attributes,
                  conditions,
                }
              : {
                  projectId: currentProject.id,
                  subjectKind,
                  subjectId: combo.subjectId,
                  predicateRelationId,
                  objectKind,
                  objectId: combo.objectId,
                  conditions,
                },
          ),
        })
        if (res.ok) created++
        else errors.push((await res.json().catch(() => ({}))).error ?? "登録に失敗しました")
      } catch {
        errors.push("登録に失敗しました")
      }
    })
    try {
      await runWithConcurrency(jobs, 5)
      await fetchAll()
      if (errors.length > 0) {
        // 失敗が混じったらダイアログは閉じない（登録済みの分は組み合わせから消える）
        setAddError(`${created}件を登録しました。${errors.length}件は登録できませんでした：${errors[0]}`)
        return
      }
      setShowAdd(false)
    } finally {
      setAdding(false)
    }
  }

  const attrsEqual = (a: Record<string, string>, b: Record<string, string>) => {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of keys) if ((a[k] ?? "") !== (b[k] ?? "")) return false
    return true
  }
  const editDirty = !!selected && (
    editDraft.subjectInstanceId !== selected.subjectInstanceId ||
    editDraft.predicateRelationId !== selected.predicateRelationId ||
    editDraft.objectInstanceId !== selected.objectInstanceId ||
    !attrsEqual(collectAttrValues(editDraft.predicateRelationId, editAttrValues), selected.attributes ?? {}) ||
    JSON.stringify(editConditions) !== JSON.stringify(selected.conditions ?? {})
  )

  const handleSave = async () => {
    if (!selected || !isComplete(editDraft)) return
    setSaving(true); setSaveError(null)
    try {
      const res = await fetch(`/api/triplets/${selected.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...editDraft,
          attributes: collectAttrValues(editDraft.predicateRelationId, editAttrValues),
          conditions: editConditions,
        }),
      })
      const updated = await res.json()
      if (!res.ok) { setSaveError(updated.error ?? "保存に失敗しました"); return }
      await fetchAll()
    } finally {
      setSaving(false)
    }
  }

  const classEditComplete = !!(
    editClassDraft.subjectId && editClassDraft.predicateRelationId && editClassDraft.objectId
  ) && !(editClassDraft.subjectKind === "instance" && editClassDraft.objectKind === "instance")

  const classEditDirty = !!selectedClassTriplet && (
    editClassDraft.subjectKind !== selectedClassTriplet.subjectKind ||
    editClassDraft.subjectId !== selectedClassTriplet.subjectId ||
    editClassDraft.predicateRelationId !== selectedClassTriplet.predicateRelationId ||
    editClassDraft.objectKind !== selectedClassTriplet.objectKind ||
    editClassDraft.objectId !== selectedClassTriplet.objectId ||
    JSON.stringify(editConditions) !== JSON.stringify(selectedClassTriplet.conditions ?? {})
  )

  const handleSaveClassTriplet = async () => {
    if (!selectedClassTriplet || !classEditComplete) return
    setSaving(true); setSaveError(null)
    try {
      const res = await fetch(`/api/class-triplets/${selectedClassTriplet.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...editClassDraft, conditions: editConditions }),
      })
      const updated = await res.json()
      if (!res.ok) { setSaveError(updated.error ?? "保存に失敗しました"); return }
      await fetchAll()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selected) return
    setDeleting(true)
    try {
      await fetch(`/api/triplets/${selected.id}`, { method: "DELETE" })
      await fetchAll()
      setSelectedId(null)
      setShowDelete(false)
    } finally {
      setDeleting(false)
    }
  }

  const cypher = useMemo(
    () =>
      triplets.length > 0 || classTriplets.length > 0
        ? buildCypher(triplets, classNameById, instById, classTriplets)
        : "",
    [triplets, classNameById, instById, classTriplets],
  )
  const nodeCount = useMemo(() => {
    const ids = new Set<string>()
    triplets.forEach((t) => { ids.add(t.subjectInstanceId); ids.add(t.objectInstanceId) })
    return ids.size
  }, [triplets])

  const handleDownloadCypher = () => {
    if (!cypher) return
    const blob = new Blob([cypher], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `triplets_${currentProject?.name ?? "graph"}.cypher`
    a.click()
    URL.revokeObjectURL(url)
  }

  const instLabel = (id: string) => {
    const inst = instById.get(id)
    if (!inst) return "（不明）"
    const cls = inst.classId ? classNameById.get(inst.classId) : undefined
    return cls ? `${inst.name}　〈${cls}〉` : inst.name
  }

  // 一覧の S → P → O。どの節でも同じ形で出し、端がクラスのときだけ種類を添える。
  const RowTriple = ({ row, size = "sm" }: { row: AnyRow; size?: "sm" | "base" }) => {
    const cls = size === "base" ? "h-auto px-2.5 py-1 text-sm font-normal" : "h-auto px-2 py-0.5 text-xs font-normal"
    const end = (kind: EndKind, label: string, title: string) => (
      <>
        <Badge variant="secondary" title={title} className={cls}>{label}</Badge>
        {kind === "class" && <span className="text-[10px] text-muted-foreground">（クラス）</span>}
      </>
    )
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {end(row.subjectKind, row.subjectLabel, row.subjectTitle)}
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <Badge variant="secondary" title="リレーション（エッジ）" className={cls}>{row.predicateLabel}</Badge>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        {end(row.objectKind, row.objectLabel, row.objectTitle)}
      </div>
    )
  }

  // クラスペア整合に基づく絞り込み（主語クラス → 選べる述語 → 選べる目的語クラス）。
  // 判定は lib/relation-inherit.ts と同じ：リレーションは親クラスで宣言され、
  // 子クラスのインスタンスはその宣言を継承して通る。
  const classByIdForPairs = useMemo(() => classMap(classes), [classes])
  const subjClassOf = (id: string) => instById.get(id)?.classId ?? null
  const relationsForSubject = (subjectId: string) => {
    const scid = subjectId ? subjClassOf(subjectId) : null
    if (!scid) return relations
    return relations.filter((r) =>
      (r.classPairs ?? []).some((p) => isSelfOrDescendant(scid, p.sourceClassId, classByIdForPairs)),
    )
  }
  const objectsForSubjectRel = (subjectId: string, relId: string) => {
    const scid = subjectId ? subjClassOf(subjectId) : null
    const rel = relId ? relById.get(relId) : null
    if (!scid || !rel) return registeredInstances
    const targets = (rel.classPairs ?? [])
      .filter((p) => isSelfOrDescendant(scid, p.sourceClassId, classByIdForPairs))
      .map((p) => p.targetClassId)
    return registeredInstances.filter(
      (i) => i.classId && targets.some((t) => isSelfOrDescendant(i.classId, t, classByIdForPairs)),
    )
  }

  // クラスごとに束ねた候補リスト。クラスの行を押せばその配下のインスタンスを
  // まとめて選べる（「このクラスをこのリレーションに当てる」という選び方になる）。
  // クラス／インスタンスの切り替え
  const renderKindToggle = (value: EndKind, onChange: (kind: EndKind) => void) => (
    <div className="flex gap-1">
      {([
        { key: "instance" as const, label: "インスタンス" },
        { key: "class" as const, label: "クラス" },
      ]).map((opt) => (
        <button key={opt.key} type="button" onClick={() => onChange(opt.key)}
          className={cn(
            "rounded-full border px-2 py-0.5 text-xs transition-colors",
            value === opt.key
              ? "border-indigo-400 bg-indigo-100 text-indigo-800 dark:border-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200"
              : "border-border text-muted-foreground hover:bg-muted",
          )}>
          {opt.label}
        </button>
      ))}
    </div>
  )

  // 候補リスト。インスタンスはクラスごとに束ね、クラスはそのまま並べる。
  // 束ねた見出しを押せば配下をまとめて選べる。
  type PickItem = { id: string; name: string; group: string }
  const renderPicker = (
    candidates: PickItem[],
    selectedIds: string[],
    onChange: (ids: string[]) => void,
    emptyText: string,
  ) => {
    if (candidates.length === 0) return <p className="text-xs text-muted-foreground">{emptyText}</p>
    const selected = new Set(selectedIds)
    const allIds = candidates.map((i) => i.id)
    const toggle = (ids: string[], on: boolean) => {
      const next = new Set(selected)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      onChange(allIds.filter((id) => next.has(id)))
    }
    return (
      <div className="rounded-md border border-border">
        <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" className="h-3.5 w-3.5 accent-indigo-600"
              checked={allIds.every((id) => selected.has(id))}
              onChange={(e) => toggle(allIds, e.target.checked)} />
            全て選択
          </label>
          <span className="text-xs text-muted-foreground">{selectedIds.length} / {candidates.length} 件</span>
        </div>
        <div className="max-h-44 overflow-y-auto p-1">
          {groupBy(candidates, (i) => i.group).map((group) => {
            const label = group[0].group
            const ids = group.map((i) => i.id)
            const all = ids.every((id) => selected.has(id))
            return (
              <div key={label || "__none__"} className="mb-1 last:mb-0">
                {label && (
                  <label className="flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-xs font-medium text-foreground hover:bg-muted">
                    <input type="checkbox" className="h-3.5 w-3.5 accent-indigo-600" checked={all}
                      ref={(el) => { if (el) el.indeterminate = !all && ids.some((id) => selected.has(id)) }}
                      onChange={(e) => toggle(ids, e.target.checked)} />
                    〈{label}〉
                    <span className="font-normal text-muted-foreground">{group.length}件</span>
                  </label>
                )}
                {group.map((i) => (
                  <label key={i.id} className={cn("flex cursor-pointer items-center gap-1.5 rounded py-0.5 pr-1.5 text-sm hover:bg-muted", label ? "pl-6" : "pl-1.5")}>
                    <input type="checkbox" className="h-3.5 w-3.5 accent-indigo-600" checked={selected.has(i.id)}
                      onChange={(e) => toggle([i.id], e.target.checked)} />
                    {i.name}
                  </label>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // --- 追加ダイアログの候補 ---
  // 述語を先に選ぶ。主語・目的語はそのリレーションに適合するものだけに絞られるので、
  // クラス単位でまとめて選んで一度に登録できる。
  const endItems = (kind: EndKind, list: (OntologyClass | OntologyInstance)[]): PickItem[] =>
    kind === "class"
      ? (list as OntologyClass[]).map((c) => ({ id: c.id, name: c.name, group: "" }))
      : (list as OntologyInstance[]).map((i) => ({
          id: i.id,
          name: i.name,
          group: i.classId ? classNameById.get(i.classId) ?? "不明" : "未分類",
        }))

  const subjectCandidates = (relId: string, kind: EndKind): PickItem[] => {
    const rel = relId ? relById.get(relId) : null
    if (!rel) return []
    const pairs = rel.classPairs ?? []
    const list =
      kind === "class"
        ? classes.filter((c) => pairs.some((p) => isSelfOrDescendant(c.id, p.sourceClassId, classByIdForPairs)))
        : registeredInstances.filter((i) => pairs.some((p) => isSelfOrDescendant(i.classId, p.sourceClassId, classByIdForPairs)))
    return endItems(kind, list)
  }

  // 選んだ主語すべてに対して終点になれるクラス
  const allowedTargetClassIds = (relId: string, kind: EndKind, subjectIds: string[]): string[] => {
    const rel = relId ? relById.get(relId) : null
    if (!rel) return []
    const pairs = rel.classPairs ?? []
    if (subjectIds.length === 0) return pairs.map((p) => p.targetClassId)
    let acc: string[] | null = null
    for (const sid of subjectIds) {
      const cid = classIdOfEnd(kind, sid)
      const allowed = pairs
        .filter((p) => isSelfOrDescendant(cid, p.sourceClassId, classByIdForPairs))
        .map((p) => p.targetClassId)
      acc = acc === null ? allowed : acc.filter((t) => allowed.includes(t))
    }
    return acc ?? []
  }

  const objectCandidates = (
    relId: string,
    subjectKind: EndKind,
    subjectIds: string[],
    objectKind: EndKind,
  ): PickItem[] => {
    const targets = allowedTargetClassIds(relId, subjectKind, subjectIds)
    if (targets.length === 0) return []
    const list =
      objectKind === "class"
        ? classes.filter((c) => targets.some((t) => isSelfOrDescendant(c.id, t, classByIdForPairs)))
        : registeredInstances.filter((i) => targets.some((t) => isSelfOrDescendant(i.classId, t, classByIdForPairs)))
    return endItems(objectKind, list)
  }

  // 成立条件の欄。述語を選ぶまでは出す項目が決まらない。
  const renderConditionsSection = (relationId: string) => {
    if (!relationId) {
      return <p className="text-sm text-muted-foreground">述語（エッジ）を選択すると、そのリレーションの条件項目が表示されます。</p>
    }
    const slots = slotsOf(relationId)
    if (slots.length === 0) {
      return (
        <p className="text-sm text-muted-foreground">
          このリレーションには条件項目が設定されていません（常に成立）。項目はリレーション管理で決めます。
        </p>
      )
    }
    return <ConditionValueList slots={slots} values={editConditions} onChange={setEditConditions} />
  }

  // クラスを含むトリプレットの編集欄。述語・両端の種類と相手を差し替えられる。
  // 候補は追加ダイアログと同じ絞り込み（クラスペアの整合を継承込みで見る）。
  const renderClassTripletEditor = () => {
    const d = editClassDraft
    const subjects = subjectCandidates(d.predicateRelationId, d.subjectKind)
    const objects = objectCandidates(d.predicateRelationId, d.subjectKind, d.subjectId ? [d.subjectId] : [], d.objectKind)
    const nameOf = (items: PickItem[], id: string) => items.find((i) => i.id === id)?.name
    const endRow = (
      label: string,
      kind: EndKind,
      id: string,
      items: PickItem[],
      onKind: (k: EndKind) => void,
      onId: (v: string) => void,
      fallback: string,
    ) => (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-sm font-medium">{label} <span className="text-destructive">*</span></Label>
          {renderKindToggle(kind, onKind)}
        </div>
        <Select value={id || "__none__"} onValueChange={(v) => onId(v && v !== "__none__" ? v : "")}>
          <SelectTrigger className="h-8 w-full min-w-0">
            <SelectValue>{nameOf(items, id) ?? (id ? fallback : "選択")}</SelectValue>
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {items.length === 0
              ? <SelectItem value="__none__" disabled>選べるものがありません</SelectItem>
              : items.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.name}{i.group ? `　〈${i.group}〉` : ""}
                  </SelectItem>
                ))}
          </SelectContent>
        </Select>
      </div>
    )
    return (
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">エッジ（述語） <span className="text-destructive">*</span></Label>
          <Select value={d.predicateRelationId || "__none__"}
            onValueChange={(v) => setEditClassDraft((prev) => ({
              ...prev,
              predicateRelationId: v && v !== "__none__" ? v : "",
              subjectId: "",
              objectId: "",
            }))}>
            <SelectTrigger className="h-8 w-full min-w-0">
              <SelectValue>{d.predicateRelationId ? (relById.get(d.predicateRelationId)?.name ?? "選択") : "選択"}</SelectValue>
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {relations.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {endRow("ノード（主語）", d.subjectKind, d.subjectId, subjects,
          (k) => setEditClassDraft((prev) => ({ ...prev, subjectKind: k, subjectId: "", objectId: "" })),
          (v) => setEditClassDraft((prev) => ({ ...prev, subjectId: v, objectId: "" })),
          selectedClassTriplet?.subjectName ?? "不明")}
        {endRow("ノード（目的語）", d.objectKind, d.objectId, objects,
          (k) => setEditClassDraft((prev) => ({ ...prev, objectKind: k, objectId: "" })),
          (v) => setEditClassDraft((prev) => ({ ...prev, objectId: v })),
          selectedClassTriplet?.objectName ?? "不明")}
        {d.subjectKind === "instance" && d.objectKind === "instance" && (
          <p className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200">
            両端ともインスタンスにはできません（それはインスタンス同士のトリプレットなので、削除して作り直してください）。
          </p>
        )}
      </div>
    )
  }

  const handleDeleteClassTriplet = async (id: string) => {
    setDeletingClassTripletId(id)
    try {
      const res = await fetch(`/api/class-triplets/${id}`, { method: "DELETE" })
      if (res.ok) setClassTriplets((prev) => prev.filter((c) => c.id !== id))
    } finally {
      setDeletingClassTripletId(null)
    }
  }

  const handleConfirmClassTriplet = async (confirmerName: string) => {
    if (!confirmClassTripletId) return
    setConfirmingClassTriplet(true)
    try {
      const res = await fetch(`/api/class-triplets/${confirmClassTripletId}/confirmations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmerName }),
      })
      if (res.ok) {
        const updated: ClassTriplet = await res.json()
        setClassTriplets((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
      }
      setConfirmClassTripletId(null)
    } finally {
      setConfirmingClassTriplet(false)
    }
  }

  const TripleSelects = ({ draft, onChange }: { draft: Draft; onChange: (d: Draft) => void }) => {
    const relOptions = relationsForSubject(draft.subjectInstanceId)
    const objOptions = objectsForSubjectRel(draft.subjectInstanceId, draft.predicateRelationId)

    // 上流が変わったら、不整合になった下流の選択を自動クリア
    const changeSubject = (v: string | null) => {
      const sid = v && v !== "__none__" ? v : ""
      const next: Draft = { ...draft, subjectInstanceId: sid }
      if (next.predicateRelationId && !relationsForSubject(sid).some((r) => r.id === next.predicateRelationId)) next.predicateRelationId = ""
      if (next.objectInstanceId && !objectsForSubjectRel(sid, next.predicateRelationId).some((o) => o.id === next.objectInstanceId)) next.objectInstanceId = ""
      onChange(next)
    }
    const changePredicate = (v: string | null) => {
      const rid = v && v !== "__none__" ? v : ""
      const next: Draft = { ...draft, predicateRelationId: rid }
      if (next.objectInstanceId && !objectsForSubjectRel(next.subjectInstanceId, rid).some((o) => o.id === next.objectInstanceId)) next.objectInstanceId = ""
      onChange(next)
    }
    const changeObject = (v: string | null) => onChange({ ...draft, objectInstanceId: v && v !== "__none__" ? v : "" })

    return (
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">ノード（主語） <span className="text-destructive">*</span></Label>
          <Select value={draft.subjectInstanceId || "__none__"} onValueChange={changeSubject}>
            <SelectTrigger className="h-8 w-full min-w-0"><SelectValue>{draft.subjectInstanceId ? instLabel(draft.subjectInstanceId) : "選択"}</SelectValue></SelectTrigger>
            <SelectContent className="max-h-72">
              {registeredInstances.map((i) => <SelectItem key={i.id} value={i.id}>{instLabel(i.id)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">エッジ（述語） <span className="text-destructive">*</span></Label>
          <Select value={draft.predicateRelationId || "__none__"} onValueChange={changePredicate} disabled={relOptions.length === 0}>
            <SelectTrigger className="h-8 w-full min-w-0"><SelectValue>{draft.predicateRelationId ? (relById.get(draft.predicateRelationId)?.name ?? "選択") : "選択"}</SelectValue></SelectTrigger>
            <SelectContent className="max-h-72">
              {relOptions.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {draft.subjectInstanceId && relOptions.length === 0 && (
            <p className="text-xs text-muted-foreground">この主語のクラスを始点に持つリレーションが定義されていません。</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">ノード（目的語） <span className="text-destructive">*</span></Label>
          <Select value={draft.objectInstanceId || "__none__"} onValueChange={changeObject}>
            <SelectTrigger className="h-8 w-full min-w-0"><SelectValue>{draft.objectInstanceId ? instLabel(draft.objectInstanceId) : "選択"}</SelectValue></SelectTrigger>
            <SelectContent className="max-h-72">
              {objOptions.map((i) => <SelectItem key={i.id} value={i.id}>{instLabel(i.id)}</SelectItem>)}
            </SelectContent>
          </Select>
          {draft.subjectInstanceId && draft.predicateRelationId && objOptions.length === 0 && (
            <p className="text-xs text-muted-foreground">この組み合わせに一致する目的語（本登録済みインスタンス）がありません。</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar group="ナレッジグラフ作成" title="トリプレット管理">
        <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-transparent"
          onClick={() => setShowExport(true)} disabled={!currentProject || (triplets.length === 0 && classTriplets.length === 0)}>
          <Download className="h-3.5 w-3.5" />Neo4jエクスポート
        </Button>
      </TopBar>

      <div className="flex flex-1 overflow-hidden">
        {/* 一覧 */}
        <div className="flex flex-1 flex-col overflow-hidden border-r border-border">
          <div className="flex items-center justify-between px-6 py-3">
            <h2 className="text-base font-semibold text-foreground">トリプレット管理</h2>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-transparent" onClick={openAdd} disabled={!currentProject}>
              <Plus className="h-3.5 w-3.5" />トリプレットを追加
            </Button>
          </div>
          <div className="flex items-center gap-2 px-6 pb-3 text-xs">
            <span className="text-muted-foreground">表示フィルター：</span>
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
                  "rounded-full border px-2.5 py-0.5 transition-colors",
                  filterState === opt.key
                    ? "border-indigo-400 bg-indigo-100 text-indigo-800 dark:border-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
                onClick={() => setFilterState(opt.key)}
              >
                {opt.label}
              </button>
            ))}
            <span className="ml-2 border-l border-border pl-3 text-muted-foreground">まとめ方：</span>
            <button
              type="button"
              className={cn(
                "rounded-full border px-2.5 py-0.5 transition-colors",
                groupByRelation
                  ? "border-indigo-400 bg-indigo-100 text-indigo-800 dark:border-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
              onClick={() => setGroupByRelation(true)}
            >
              リレーションごと
            </button>
            <button
              type="button"
              className={cn(
                "rounded-full border px-2.5 py-0.5 transition-colors",
                !groupByRelation
                  ? "border-indigo-400 bg-indigo-100 text-indigo-800 dark:border-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
              onClick={() => setGroupByRelation(false)}
            >
              まとめない
            </button>
            {movingOrder && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            {!canReorder && (
              <span className="text-muted-foreground">（絞り込み中は並べ替えできません）</span>
            )}
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
          <div className="flex-1 overflow-auto px-6 pb-6">
            {loading && rows.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : !currentProject ? (
              <p className="p-4 text-center text-sm text-muted-foreground">プロジェクトを選択してください</p>
            ) : rows.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">トリプレットが登録されていません</p>
            ) : (
              <ListDndContext
                onDrop={handleRowDrop}
                canDrop={canDropRow}
                labelOf={(id) => {
                  const r = rowById.get(id)
                  return (
                    <span className="font-medium text-foreground">
                      {r ? `${r.subjectLabel} → ${r.predicateLabel} → ${r.objectLabel}` : id}
                    </span>
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
                          aria-label="表示中のトリプレットをすべて選択"
                          checked={displayedRows.length > 0 && displayedRows.every((r) => selectedIds.has(r.id))}
                          onChange={(e) => {
                            const next = new Set(selectedIds)
                            if (e.target.checked) displayedRows.forEach((r) => next.add(r.id))
                            else displayedRows.forEach((r) => next.delete(r.id))
                            setSelectedIds(next)
                          }}
                        />
                      </TableHead>
                      <TableHead className="font-semibold text-foreground">トリプレット</TableHead>
                      <TableHead className="w-32 font-semibold text-foreground">確認</TableHead>
                      <TableHead className="w-36 font-semibold text-foreground">出典</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {listRows.map((item) => {
                      if (item.kind === "section") {
                        const collapsed = collapsedGroupKeys.has(item.pattern)
                        return (
                          <DropRow key={item.key} id={item.key} enabled={canReorder} className="bg-muted/70 hover:bg-muted/70">
                            <TableCell colSpan={5} className="py-2">
                              <button
                                type="button"
                                aria-label={`${item.label}を${collapsed ? "開く" : "閉じる"}`}
                                onClick={() => toggleGroupKey(item.pattern)}
                                className="flex w-full items-start gap-2 text-left"
                              >
                                <span className="mt-0.5 shrink-0">
                                  {collapsed
                                    ? <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                    : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                                </span>
                                <span className="min-w-0">
                                  <span className="flex items-center gap-2">
                                    <span className="text-sm font-semibold text-foreground">{item.label}</span>
                                    <span className="text-xs text-muted-foreground">{item.count}件</span>
                                  </span>
                                  {!collapsed && (
                                    <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{item.note}</span>
                                  )}
                                </span>
                              </button>
                            </TableCell>
                          </DropRow>
                        )
                      }
                      if (item.kind === "group") {
                        const collapsed = collapsedGroupKeys.has(item.groupKey)
                        return (
                          <DropRow key={item.key} id={item.key} enabled={canReorder} className="bg-muted/30 hover:bg-muted/30">
                            <TableCell colSpan={5} className="py-1.5 pl-8">
                              <button
                                type="button"
                                aria-label={`${item.label}を${collapsed ? "開く" : "閉じる"}`}
                                onClick={() => toggleGroupKey(item.groupKey)}
                                className="flex items-center gap-2 text-xs font-semibold text-foreground"
                              >
                                {collapsed
                                  ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                  : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                                {item.label}
                                <span className="font-normal text-muted-foreground">{item.count}件</span>
                              </button>
                            </TableCell>
                          </DropRow>
                        )
                      }
                      const r = item.row
                      const confirmStatus = deriveConfirmationStatus(r.confirmations)
                      const label = `${r.subjectLabel}→${r.predicateLabel}→${r.objectLabel}`
                      return (
                        <DragRow
                          key={item.key}
                          id={r.id}
                          label={label}
                          enabled={canReorder}
                          className={cn(
                            "cursor-pointer transition-colors",
                            selectedId === r.id
                              ? "bg-indigo-100 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-950/50"
                              : "hover:bg-muted/50",
                          )}
                          onClick={() => setSelectedId(r.id)}>
                          <TableCell className="align-middle" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              aria-label={`${label}を選択`}
                              checked={selectedIds.has(r.id)}
                              onChange={() => toggleSelectConfirm(r.id)}
                            />
                          </TableCell>
                          <TableCell className="align-middle"><RowTriple row={r} /></TableCell>
                          <TableCell className="align-middle">
                            <ConfirmationBadge state={confirmStatus.state} latestConfirm={confirmStatus.latestConfirm} />
                          </TableCell>
                          <TableCell className="align-middle text-sm text-muted-foreground">{r.sourceDocName || "—"}</TableCell>
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

        {/* 詳細（右ペイン・常時表示） */}
        <div className="flex w-[30rem] shrink-0 flex-col overflow-hidden bg-card">
          {selected ? (
            <>
              <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
                <section className="space-y-3">
                  <SectionHeader icon={FileText} title="基本情報" />
                  <div className="space-y-3">
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <ConfirmationSummary events={selected.confirmations} fieldLabels={TRIPLET_FIELD_LABEL} />
                      <p>登録日 {formatDateTime(selected.createdAt)}{selected.createdBy ? `（${selected.createdBy}）` : ""}</p>
                      <p>更新日 {formatDateTime(selected.updatedAt)}{selected.updatedBy ? `（${selected.updatedBy}）` : ""}</p>
                    </div>
                    <TripleSelects draft={editDraft} onChange={setEditDraft} />
                    {selected.sourceDocName && (
                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium">出典</Label>
                        <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">{selected.sourceDocName}</p>
                      </div>
                    )}
                    {selected.evidence && (
                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium">抽出元文章</Label>
                        <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">{selected.evidence}</p>
                      </div>
                    )}
                    {saveError && <p className="text-sm text-destructive">{saveError}</p>}
                  </div>
                </section>

                {/* 属性（述語リレーションに定義された属性の値） */}
                <section className="space-y-3">
                  <SectionHeader icon={Tags} title="属性" />
                  <div>
                    {!editDraft.predicateRelationId ? (
                      <p className="text-sm text-muted-foreground">述語（エッジ）を選択すると、そのリレーションの属性が表示されます。</p>
                    ) : loadingAttrs && !attrsByRelation[editDraft.predicateRelationId] ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />属性を読み込み中…
                      </div>
                    ) : (attrsByRelation[editDraft.predicateRelationId] ?? []).length === 0 ? (
                      <p className="text-sm text-muted-foreground">このリレーションには属性が設定されていません</p>
                    ) : (
                      <AttrValueList
                        attrs={attrsByRelation[editDraft.predicateRelationId] ?? []}
                        values={editAttrValues}
                        onChange={(id, v) => setEditAttrValues((prev) => ({ ...prev, [id]: v }))}
                      />
                    )}
                  </div>
                </section>

                {/* 成立条件（述語リレーションが宣言した項目に、このトリプレットの値を入れる） */}
                <section className="space-y-3">
                  <SectionHeader icon={SlidersHorizontal} title="成立条件" />
                  {renderConditionsSection(editDraft.predicateRelationId)}
                </section>
              </div>

              <div className="flex items-center justify-between border-t border-border px-4 py-3">
                <Button variant="ghost" size="sm"
                  className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setShowDelete(true)}>
                  <Trash2 className="h-3.5 w-3.5" />削除
                </Button>
                <Button size="sm" variant="success" onClick={handleSave} disabled={!isComplete(editDraft) || saving || !editDirty || hasMissingRequired(attrsByRelation[editDraft.predicateRelationId] ?? [], editAttrValues) || hasIncompleteConditions(slotsOf(editDraft.predicateRelationId), editConditions)}>
                  {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}保存
                </Button>
              </div>
            </>
          ) : selectedClassTriplet ? (
            <>
              <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
                <section className="space-y-3">
                  <SectionHeader icon={FileText} title="基本情報" />
                  <div className="space-y-3">
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <ConfirmationSummary events={selectedClassTriplet.confirmations} fieldLabels={TRIPLET_FIELD_LABEL} />
                      <p>登録日 {formatDateTime(selectedClassTriplet.createdAt)}{selectedClassTriplet.createdBy ? `（${selectedClassTriplet.createdBy}）` : ""}</p>
                      <p>更新日 {formatDateTime(selectedClassTriplet.updatedAt)}{selectedClassTriplet.updatedBy ? `（${selectedClassTriplet.updatedBy}）` : ""}</p>
                    </div>
                    {renderClassTripletEditor()}
                    {saveError && <p className="text-sm text-destructive">{saveError}</p>}
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">確認</Label>
                      <div className="flex items-center gap-2">
                        {(() => {
                          const status = deriveConfirmationStatus(selectedClassTriplet.confirmations)
                          return (
                            <>
                              <ConfirmationBadge state={status.state} latestConfirm={status.latestConfirm} />
                              {status.state === "unconfirmed" && (
                                <Button size="sm" variant="outline" className="h-7 gap-1.5 bg-transparent"
                                  onClick={() => setConfirmClassTripletId(selectedClassTriplet.id)}>
                                  <CheckCircle2 className="h-3.5 w-3.5" />確認する
                                </Button>
                              )}
                            </>
                          )
                        })()}
                      </div>
                    </div>
                  </div>
                </section>

                {/* 成立条件 */}
                <section className="space-y-3">
                  <SectionHeader icon={SlidersHorizontal} title="成立条件" />
                  {renderConditionsSection(editClassDraft.predicateRelationId)}
                </section>
              </div>

              <div className="flex items-center justify-between border-t border-border px-4 py-3">
                <Button variant="ghost" size="sm"
                  className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={deletingClassTripletId === selectedClassTriplet.id}
                  onClick={async () => {
                    await handleDeleteClassTriplet(selectedClassTriplet.id)
                    setSelectedId(null)
                  }}>
                  {deletingClassTripletId === selectedClassTriplet.id
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Trash2 className="h-3.5 w-3.5" />}
                  削除
                </Button>
                <Button size="sm" variant="success" onClick={handleSaveClassTriplet}
                  disabled={!classEditComplete || saving || !classEditDirty || hasIncompleteConditions(slotsOf(editClassDraft.predicateRelationId), editConditions)}>
                  {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}保存
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
              トリプレットを選択してください
            </div>
          )}
        </div>
      </div>

      {/* 追加ダイアログ */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>トリプレットを追加</DialogTitle></DialogHeader>
          {noPrereq ? (
            <p className="py-4 text-sm text-muted-foreground">
              トリプレットの作成には、本登録済みインスタンスが2つ以上と、定義済みリレーションが必要です。先にオントロジー設計（インスタンスの本登録とリレーション定義）を進めてください。
            </p>
          ) : (
            <div className="min-w-0 space-y-4 py-2">
              {/* 述語を先に選ぶ。主語・目的語はそれに適合するものだけが並ぶので、
                  クラス単位でまとめて選んで一度に登録できる。
                  主語・目的語それぞれクラスかインスタンスかを選べるので、4通りを
                  このダイアログで作れる。 */}
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">エッジ（述語） <span className="text-destructive">*</span></Label>
                <Select value={addDraft.predicateRelationId || "__none__"}
                  onValueChange={(v) => setAddDraft((d) => ({ ...d, predicateRelationId: v && v !== "__none__" ? v : "", subjectIds: [], objectIds: [] }))}>
                  <SelectTrigger className="h-8 w-full min-w-0">
                    <SelectValue>{addDraft.predicateRelationId ? (relById.get(addDraft.predicateRelationId)?.name ?? "選択") : "選択"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {relations.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {addDraft.predicateRelationId && (
                <>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Label className="text-sm font-medium">主語 <span className="text-destructive">*</span></Label>
                      {renderKindToggle(addDraft.subjectKind, (kind) =>
                        setAddDraft((d) => ({ ...d, subjectKind: kind, subjectIds: [], objectIds: [] })),
                      )}
                    </div>
                    {renderPicker(
                      subjectCandidates(addDraft.predicateRelationId, addDraft.subjectKind),
                      addDraft.subjectIds,
                      (ids) => setAddDraft((d) => {
                        const ok = new Set(objectCandidates(d.predicateRelationId, d.subjectKind, ids, d.objectKind).map((i) => i.id))
                        return { ...d, subjectIds: ids, objectIds: d.objectIds.filter((id) => ok.has(id)) }
                      }),
                      addDraft.subjectKind === "class"
                        ? "この述語の始点になれるクラスがありません。"
                        : "この述語の始点になれる本登録済みインスタンスがありません。",
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Label className="text-sm font-medium">目的語 <span className="text-destructive">*</span></Label>
                      {renderKindToggle(addDraft.objectKind, (kind) =>
                        setAddDraft((d) => ({ ...d, objectKind: kind, objectIds: [] })),
                      )}
                    </div>
                    {renderPicker(
                      objectCandidates(addDraft.predicateRelationId, addDraft.subjectKind, addDraft.subjectIds, addDraft.objectKind),
                      addDraft.objectIds,
                      (ids) => setAddDraft((d) => ({ ...d, objectIds: ids })),
                      addDraft.objectKind === "class"
                        ? "この述語の終点になれるクラスがありません。"
                        : "この述語の終点になれる本登録済みインスタンスがありません。",
                    )}
                  </div>
                  <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    {addDraft.subjectKind === "instance" && addDraft.objectKind === "instance"
                      ? "個別の事実として登録します。"
                      : addDraft.subjectKind === "class" && addDraft.objectKind === "instance"
                        ? "そのクラスのインスタンスすべてが、選んだ相手と関係する、という意味になります。子クラスにも継承されます。"
                        : addDraft.subjectKind === "class"
                          ? "そのクラスのインスタンスは、相手クラスのいずれかと関係する、という意味になります。子クラスにも継承されます。"
                          : "その個別のものが、相手クラスのいずれかと関係する（相手は特定できていない）、という意味になります。"}
                  </p>
                </>
              )}
              {/* 属性（述語リレーションに定義された属性の値）。クラスを含む方は属性を持たない。 */}
              {addDraft.predicateRelationId && bothInstance && (
                loadingAttrs && !attrsByRelation[addDraft.predicateRelationId] ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />属性を読み込み中…
                  </div>
                ) : (attrsByRelation[addDraft.predicateRelationId] ?? []).length > 0 ? (
                  <div className="space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">リレーション属性</p>
                    <AttrValueList
                      attrs={attrsByRelation[addDraft.predicateRelationId] ?? []}
                      values={addAttrValues}
                      onChange={(id, v) => setAddAttrValues((prev) => ({ ...prev, [id]: v }))}
                    />
                  </div>
                ) : null
              )}
              {/* 成立条件（述語リレーションが宣言した項目に、ここで値を入れる） */}
              {addDraft.predicateRelationId && slotsOf(addDraft.predicateRelationId).length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">成立条件</p>
                  <ConditionValueList
                    slots={slotsOf(addDraft.predicateRelationId)}
                    values={addConditions}
                    onChange={setAddConditions}
                  />
                </div>
              )}
              {addCombos.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {addCombos.length}件のトリプレットを作成します{addSkipped > 0 ? `（登録済みの${addSkipped}件は除きます）` : ""}。
                  {bothInstance && (attrsByRelation[addDraft.predicateRelationId] ?? []).length > 0 && "属性の値は全件に同じものが入ります。"}
                  {Object.keys(addConditions).length > 0 && "成立条件も全件に同じものが入ります。"}
                </p>
              )}
              {addCombos.length === 0 && addSkipped > 0 && (
                <p className="text-xs text-muted-foreground">選んだ組み合わせ（{addSkipped}件）はすべて登録済みです。</p>
              )}
              {addError && <p className="text-sm text-destructive">{addError}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>キャンセル</Button>
            <Button onClick={handleAdd} disabled={noPrereq || addCombos.length === 0 || adding || (bothInstance && hasMissingRequired(attrsByRelation[addDraft.predicateRelationId] ?? [], addAttrValues)) || hasIncompleteConditions(slotsOf(addDraft.predicateRelationId), addConditions)}>
              {adding ? "登録中..." : addCombos.length > 0 ? `${addCombos.length}件を登録` : "登録"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmClassTripletId}
        onOpenChange={(open) => { if (!open) setConfirmClassTripletId(null) }}
        title="トリプレットを確認する"
        description="このトリプレットに確認レコードが追加されます。"
        submitting={confirmingClassTriplet}
        onSubmit={handleConfirmClassTriplet}
      />

      {/* 削除確認 */}
      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent>
          <DialogHeader><DialogTitle>トリプレットを削除</DialogTitle></DialogHeader>
          {selected && deriveConfirmationStatus(selected.confirmations).state !== "unconfirmed" ? (
            <p className="text-sm font-medium text-destructive">
              このトリプレットは確認済みです。本当に削除しますか？ この操作は取り消せません。
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">このトリプレットを削除します。この操作は取り消せません。</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)} disabled={deleting}>キャンセル</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>{deleting ? "削除中..." : "削除する"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Neo4jエクスポート */}
      <Dialog open={showExport} onOpenChange={setShowExport}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>Neo4j へエクスポート</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              本登録トリプレット {triplets.length} 件 ／ ノード {nodeCount}・エッジ {triplets.length}。冪等な Cypher（MERGE）です。Neo4j Aura の Browser / cypher-shell に貼るか、ダウンロードして実行してください。
            </p>
            <pre className="max-h-80 overflow-auto rounded-lg bg-zinc-950 p-4 text-xs leading-relaxed text-zinc-100">{cypher}</pre>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExport(false)}>閉じる</Button>
            <Button className="gap-1.5" onClick={handleDownloadCypher} disabled={!cypher}>
              <Download className="h-4 w-4" />.cypher をダウンロード
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 一括確認ダイアログ */}
      <ConfirmDialog
        open={showBulkConfirm}
        onOpenChange={setShowBulkConfirm}
        title={`選択した${selectedIds.size}件のトリプレットを確認する`}
        description="選択したすべてのトリプレットに同一の確認レコードが追加されます。"
        submitting={bulkConfirming}
        onSubmit={handleBulkConfirm}
      />
    </div>
  )
}
