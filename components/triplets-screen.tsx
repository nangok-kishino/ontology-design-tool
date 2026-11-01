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
import { cn } from "@/lib/utils"
import { classMap, isSelfOrDescendant } from "@/lib/relation-inherit"
import { useProject } from "@/app/project-context"
import { isRegistered } from "@/lib/instance-status"
import { groupBy, runWithConcurrency } from "@/lib/concurrency"
import { orderBetween, placeAt, renumber, sortByOrder } from "@/lib/organize"
import { buildCypher } from "@/lib/graph-export"
import type { Triplet, ClassTriplet, OntologyInstance, OntologyRelation, OntologyClass, OntologyAttribute } from "@/lib/types"
import { ArrowRight, Plus, Trash2, Loader2, Download, FileText, Tags, CheckCircle2, X, ChevronDown, ChevronRight } from "lucide-react"
import { deriveConfirmationStatus, type ConfirmationState } from "@/lib/confirmation"
import { ConfirmationBadge } from "@/components/confirmation-badge"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { ConfirmationSummary } from "@/components/confirmation-summary"

// グループ見出しの行id。トリプレットのidと混ざらないように印を付ける。
const GROUP_ROW_PREFIX = "group:"

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
  const [classSectionOpen, setClassSectionOpen] = useState(true)
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

  const registeredInstances = useMemo(
    () => instances.filter((i) => isRegistered(i)).sort((a, b) => a.name.localeCompare(b.name, "ja")),
    [instances],
  )
  const classNameById = useMemo(() => new Map(classes.map((c) => [c.id, c.name])), [classes])
  const instById = useMemo(() => new Map(instances.map((i) => [i.id, i])), [instances])
  const relById = useMemo(() => new Map(relations.map((r) => [r.id, r])), [relations])
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

  // 表示中トリプレット（確認状態フィルタ）。並びは order（未設定は末尾）。
  const displayedTriplets = useMemo(() => {
    const base = filterState === "all"
      ? triplets
      : triplets.filter((t) => deriveConfirmationStatus(t.confirmations).state === filterState)
    return sortByOrder(base)
  }, [triplets, filterState])

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
    | { kind: "group"; key: string; groupKey: string; label: string; count: number }
    | { kind: "triplet"; key: string; t: Triplet }

  // 述語リレーションごとに仕分けして並べる。見出しの順はリレーション管理の並び順に合わせ、
  // 定義が見つからない述語（消されたリレーション）は最後にまとめる。
  const listRows: ListRow[] = useMemo(() => {
    if (!groupByRelation) {
      return displayedTriplets.map((t) => ({ kind: "triplet" as const, key: t.id, t }))
    }
    const buckets = new Map<string, Triplet[]>()
    for (const t of displayedTriplets) {
      const list = buckets.get(t.predicateRelationId)
      if (list) list.push(t)
      else buckets.set(t.predicateRelationId, [t])
    }
    const known = sortByOrder(relations).map((r) => r.id)
    const rest = [...buckets.keys()].filter((id) => !known.includes(id)).sort()
    return [...known, ...rest].flatMap((relationId) => {
      const items = buckets.get(relationId) ?? []
      if (items.length === 0) return []
      return [
        {
          kind: "group" as const,
          key: `${GROUP_ROW_PREFIX}${relationId}`,
          groupKey: relationId,
          label: relById.get(relationId)?.name ?? items[0].predicateName ?? "（定義なし）",
          count: items.length,
        },
        ...(collapsedGroupKeys.has(relationId)
          ? []
          : items.map((t) => ({ kind: "triplet" as const, key: t.id, t }))),
      ]
    })
  }, [displayedTriplets, groupByRelation, relations, relById, collapsedGroupKeys])

  // 並び順の書き込み。前後に隙間があればその1件だけ、尽きていたら並び全体を振り直す。
  // order は整理の都合なので、確認履歴にも更新日時にも手を付けない（サーバ側も同じ方針）。
  const applyOrder = async (ordered: Triplet[], index: number) => {
    if (!currentProject) return
    const unnumbered = ordered.some((t) => t.order === undefined)
    const between = unnumbered ? null : orderBetween(ordered[index - 1], ordered[index + 1])
    const updates = between === null
      ? renumber(ordered)
      : [{ id: ordered[index].id, order: between }]
    const byId = new Map(updates.map((u) => [u.id, u.order]))
    const before = triplets
    setMovingOrder(true)
    setTriplets((prev) => prev.map((t) => (byId.has(t.id) ? { ...t, order: byId.get(t.id) } : t)))
    try {
      const res = await fetch("/api/triplets/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: currentProject.id, updates }),
      })
      if (!res.ok) setTriplets(before)
    } catch {
      setTriplets(before)
    } finally {
      setMovingOrder(false)
    }
  }

  // 落とし先の行が属する並び（グループ表示なら同じ述語の中だけ）
  const siblingsOf = (t: Triplet) =>
    groupByRelation
      ? displayedTriplets.filter((x) => x.predicateRelationId === t.predicateRelationId)
      : displayedTriplets

  // 述語が違う行には落とせない。述語を変えるのは並べ替えではなく編集なので、
  // ドラッグで変わってしまわないようにする。
  const predicateOfRow = (rowId: string) =>
    rowId.startsWith(GROUP_ROW_PREFIX)
      ? rowId.slice(GROUP_ROW_PREFIX.length)
      : triplets.find((t) => t.id === rowId)?.predicateRelationId ?? null

  const canDropRow = (activeId: string, overId: string) => {
    if (!groupByRelation) return true
    const a = predicateOfRow(activeId)
    return a !== null && a === predicateOfRow(overId)
  }

  // 一覧表で行を落としたとき。見出しならその末尾、行ならその位置へ入れる。
  const handleRowDrop = (activeId: string, overId: string) => {
    const moved = triplets.find((t) => t.id === activeId)
    if (!moved || !canDropRow(activeId, overId)) return
    const list = siblingsOf(moved)
    if (overId.startsWith(GROUP_ROW_PREFIX)) {
      const { ordered, index } = placeAt(list, moved)
      applyOrder(ordered, index)
      return
    }
    const target = triplets.find((t) => t.id === overId)
    if (!target) return
    const { ordered, index } = placeAt(list, moved, target.id)
    applyOrder(ordered, index)
  }

  const confirmSelectedStates = Array.from(selectedIds).map((id) => {
    const t = triplets.find((tt) => tt.id === id)
    return deriveConfirmationStatus(t?.confirmations).state
  })
  const canBulkConfirm = confirmSelectedStates.some((s) => s === "unconfirmed" || s === "confirmed_edited")
  const canBulkUnconfirm = confirmSelectedStates.some((s) => s === "confirmed" || s === "confirmed_edited")

  const handleBulkConfirm = async (confirmerName: string) => {
    const targets = Array.from(selectedIds).filter((id) => {
      const t = triplets.find((tt) => tt.id === id)
      const s = deriveConfirmationStatus(t?.confirmations).state
      return s === "unconfirmed" || s === "confirmed_edited"
    })
    if (targets.length === 0) return
    setBulkConfirming(true)
    try {
      await Promise.all(
        targets.map((id) =>
          fetch(`/api/triplets/${id}/confirmations`, {
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
      const t = triplets.find((tt) => tt.id === id)
      const s = deriveConfirmationStatus(t?.confirmations).state
      return s === "confirmed" || s === "confirmed_edited"
    })
    if (targets.length === 0) return
    setBulkUnconfirming(true)
    try {
      await Promise.all(
        targets.map((id) => fetch(`/api/triplets/${id}/confirmations`, { method: "DELETE" }))
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
      if (selected.predicateRelationId) ensureRelAttrs(selected.predicateRelationId)
      setSaveError(null)
    }
  }, [selectedId])

  // 未選択時は先頭を自動選択
  useEffect(() => {
    if (loading || selectedId || triplets.length === 0) return
    setSelectedId(triplets[0].id)
  }, [loading, selectedId, triplets.length])

  // 3要素すべて選択済みか（保存/追加の活性判定）。クラスペアの整合はサーバが検証し、
  // 不整合ならエラーを返す（前設計の整合表示は廃止）。
  const isComplete = (d: Draft) => !!(d.subjectInstanceId && d.predicateRelationId && d.objectInstanceId)

  // クラスを端に使えるので、インスタンスが2件なくても作れる
  const noPrereq = relations.length === 0 || classes.length === 0

  const openAdd = () => { setAddDraft(EMPTY_ADD); setAddAttrValues({}); setAddError(null); setShowAdd(true) }

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
                }
              : {
                  projectId: currentProject.id,
                  subjectKind,
                  subjectId: combo.subjectId,
                  predicateRelationId,
                  objectKind,
                  objectId: combo.objectId,
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
    !attrsEqual(collectAttrValues(editDraft.predicateRelationId, editAttrValues), selected.attributes ?? {})
  )

  const handleSave = async () => {
    if (!selected || !isComplete(editDraft)) return
    setSaving(true); setSaveError(null)
    try {
      const res = await fetch(`/api/triplets/${selected.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...editDraft, attributes: collectAttrValues(editDraft.predicateRelationId, editAttrValues) }),
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

  // S → P → O をノード/エッジのBadgeで表示（クラス名はマウスオーバー）
  const TripleView = ({ t, size = "sm" }: { t: Triplet; size?: "sm" | "base" }) => {
    const cls = size === "base" ? "h-auto px-2.5 py-1 text-sm font-normal" : "h-auto px-2 py-0.5 text-xs font-normal"
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary" title={`クラス：${className(t.subjectClassId)}`} className={cls}>{t.subjectName}</Badge>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <Badge variant="secondary" title="リレーション（エッジ）" className={cls}>{t.predicateName}</Badge>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <Badge variant="secondary" title={`クラス：${className(t.objectClassId)}`} className={cls}>{t.objectName}</Badge>
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
            {/* クラストリプレット（主語がクラス）。作成・削除はここで、編集は作り直し。 */}
            {currentProject && (
              <div className="mb-4 rounded-lg border border-border">
                <button
                  type="button"
                  onClick={() => setClassSectionOpen((v) => !v)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left"
                >
                  {classSectionOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                  <span className="text-sm font-semibold text-foreground">クラスを含むトリプレット</span>
                  <span className="text-xs text-muted-foreground">{classTriplets.length}件</span>
                </button>
                {classSectionOpen && (
                  <div className="border-t border-border">
                    <p className="px-3 py-2 text-xs text-muted-foreground">
                      どちらかの端がクラスのトリプレットです。主語がクラスのものは、そのクラスの
                      インスタンスすべてに当てはまり、子クラスにも継承されます。
                    </p>
                    {classTriplets.length === 0 ? (
                      <p className="px-3 pb-3 text-sm text-muted-foreground">まだありません。</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/50 hover:bg-muted/50">
                            <TableHead className="font-semibold text-foreground">トリプレット</TableHead>
                            <TableHead className="w-40 font-semibold text-foreground">確認</TableHead>
                            <TableHead className="w-12" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {classTriplets.map((ct) => {
                            const status = deriveConfirmationStatus(ct.confirmations)
                            return (
                              <TableRow key={ct.id}>
                                <TableCell>
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <Badge variant="secondary" title={ct.subjectKind === "class" ? "クラス" : "インスタンス"} className="h-auto px-2 py-0.5 text-xs font-normal">
                                      {ct.subjectKind === "class"
                                        ? classNameById.get(ct.subjectId) ?? ct.subjectName
                                        : instById.get(ct.subjectId)?.name ?? ct.subjectName}
                                    </Badge>
                                    <span className="text-[10px] text-muted-foreground">
                                      {ct.subjectKind === "class" ? "（クラス）" : "（インスタンス）"}
                                    </span>
                                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                    <Badge variant="secondary" title="リレーション" className="h-auto px-2 py-0.5 text-xs font-normal">
                                      {relById.get(ct.predicateRelationId)?.name ?? ct.predicateName}
                                    </Badge>
                                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                    <Badge variant="secondary" title={ct.objectKind === "class" ? "クラス" : "インスタンス"} className="h-auto px-2 py-0.5 text-xs font-normal">
                                      {ct.objectName}
                                    </Badge>
                                    <span className="text-[10px] text-muted-foreground">
                                      {ct.objectKind === "class" ? "（クラス）" : "（インスタンス）"}
                                    </span>
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-1.5">
                                    <ConfirmationBadge state={status.state} latestConfirm={status.latestConfirm} />
                                    {status.state === "unconfirmed" && (
                                      <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs"
                                        onClick={() => setConfirmClassTripletId(ct.id)}>
                                        確認する
                                      </Button>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Button size="icon" variant="ghost"
                                    className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                    aria-label={`${ct.subjectName}のトリプレットを削除`}
                                    disabled={deletingClassTripletId === ct.id}
                                    onClick={() => handleDeleteClassTriplet(ct.id)}>
                                    {deletingClassTripletId === ct.id
                                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      : <Trash2 className="h-3.5 w-3.5" />}
                                  </Button>
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                )}
              </div>
            )}
            {loading && triplets.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : !currentProject ? (
              <p className="p-4 text-center text-sm text-muted-foreground">プロジェクトを選択してください</p>
            ) : triplets.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">トリプレットが登録されていません</p>
            ) : (
              <ListDndContext
                onDrop={handleRowDrop}
                canDrop={canDropRow}
                labelOf={(id) => {
                  const t = triplets.find((x) => x.id === id)
                  return (
                    <span className="font-medium text-foreground">
                      {t ? `${t.subjectName} → ${t.predicateName} → ${t.objectName}` : id}
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
                          checked={displayedTriplets.length > 0 && displayedTriplets.every((t) => selectedIds.has(t.id))}
                          onChange={(e) => {
                            const next = new Set(selectedIds)
                            if (e.target.checked) displayedTriplets.forEach((t) => next.add(t.id))
                            else displayedTriplets.forEach((t) => next.delete(t.id))
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
                    {listRows.map((row) => {
                      if (row.kind === "group") {
                        const collapsed = collapsedGroupKeys.has(row.groupKey)
                        return (
                          <DropRow key={row.key} id={row.key} enabled={canReorder} className="bg-muted/40 hover:bg-muted/40">
                            <TableCell colSpan={5} className="py-1.5">
                              <button
                                type="button"
                                aria-label={`${row.label}を${collapsed ? "開く" : "閉じる"}`}
                                onClick={() => toggleGroupKey(row.groupKey)}
                                className="flex items-center gap-2 text-xs font-semibold text-foreground"
                              >
                                {collapsed
                                  ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                  : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                                {row.label}
                                <span className="font-normal text-muted-foreground">{row.count}件</span>
                              </button>
                            </TableCell>
                          </DropRow>
                        )
                      }
                      const t = row.t
                      const confirmStatus = deriveConfirmationStatus(t.confirmations)
                      const state = confirmStatus.state
                      const isChecked = selectedIds.has(t.id)
                      return (
                        <DragRow
                          key={row.key}
                          id={t.id}
                          label={`${t.subjectName}→${t.predicateName}→${t.objectName}`}
                          enabled={canReorder}
                          className={cn(
                            "cursor-pointer transition-colors",
                            selectedId === t.id
                              ? "bg-indigo-100 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-950/50"
                              : "hover:bg-muted/50",
                          )}
                          onClick={() => setSelectedId(t.id)}>
                          <TableCell className="align-middle" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              aria-label={`${t.subjectName}→${t.predicateName}→${t.objectName}を選択`}
                              checked={isChecked}
                              onChange={() => toggleSelectConfirm(t.id)}
                            />
                          </TableCell>
                          <TableCell className="align-middle"><TripleView t={t} /></TableCell>
                          <TableCell className="align-middle">
                            <ConfirmationBadge state={state} latestConfirm={confirmStatus.latestConfirm} />
                          </TableCell>
                          <TableCell className="align-middle text-sm text-muted-foreground">{t.sourceDocName || "—"}</TableCell>
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
              </div>

              <div className="flex items-center justify-between border-t border-border px-4 py-3">
                <Button variant="ghost" size="sm"
                  className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setShowDelete(true)}>
                  <Trash2 className="h-3.5 w-3.5" />削除
                </Button>
                <Button size="sm" variant="success" onClick={handleSave} disabled={!isComplete(editDraft) || saving || !editDirty || hasMissingRequired(attrsByRelation[editDraft.predicateRelationId] ?? [], editAttrValues)}>
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
              {addCombos.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {addCombos.length}件のトリプレットを作成します{addSkipped > 0 ? `（登録済みの${addSkipped}件は除きます）` : ""}。
                  {bothInstance && (attrsByRelation[addDraft.predicateRelationId] ?? []).length > 0 && "属性の値は全件に同じものが入ります。"}
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
            <Button onClick={handleAdd} disabled={noPrereq || addCombos.length === 0 || adding || (bothInstance && hasMissingRequired(attrsByRelation[addDraft.predicateRelationId] ?? [], addAttrValues))}>
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
