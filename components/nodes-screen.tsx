"use client"

// ノード管理（グラフデータ作成）。旧インスタンス管理の後継。
//
// 大きく変わるのは、所属が1つのクラスではなく【複数のラベル】になること。
// 旧モデルで子クラスに属していたものは、祖先のラベルも併せ持つ（docs/graph-model.md）。
// そのため
//   - 左ペインはクラスの木ではなく、ラベルでの絞り込みになる
//   - 持てるプロパティは「付与された全ラベルのプロパティの和集合」＋プロジェクト共通になる
// という形にしてある。

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label as FieldLabel } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { TopBar } from "@/components/top-bar"
import { Tooltip } from "@/components/ui/tooltip"
import { SectionHeader } from "@/components/section-header"
import { ConfirmationBadge } from "@/components/confirmation-badge"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { ConfirmationSummary } from "@/components/confirmation-summary"
import { DragRow, ListDndContext } from "@/components/list-dnd"
import { PropertyValueList, hasMissingRequired } from "@/components/property-section"
import { cn } from "@/lib/utils"
import { nextOrder, placeAt, sortByOrder, orderBetween, ORDER_STEP } from "@/lib/organize"
import { normalizeName } from "@/lib/normalize"
import { deriveConfirmationStatus, type ConfirmationState } from "@/lib/confirmation"
import type { GraphNode, Label, PropertyDef } from "@/lib/graph-types"
import { NodeNameCheckDialog } from "@/components/node-name-check-dialog"
import { LabelChip, LabelChips } from "@/components/label-chip"
import {
  ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, FileText, Loader2, Lock, Merge, Plus, Search, Tags,
  Trash2, Undo2, X,
} from "lucide-react"
import { useProject } from "@/app/project-context"

const ALL = "__all__"
const UNLABELED = "__none__"

const NODE_FIELD_LABEL: Record<string, string> = {
  name: "ノード名",
  labelIds: "ラベル",
  properties: "プロパティ",
}

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

// 名寄せチェックの済／未。status 未設定の既存データは済として扱う（旧モデルからの引き継ぎ）。
function nameChecked(n: GraphNode): boolean {
  return (n.status ?? "confirmed") === "confirmed"
}

export function NodesScreen({ initialSelectedLabelId, active }: {
  initialSelectedLabelId?: string
  active?: boolean
}) {
  const { currentProject, loading: projectLoading } = useProject()
  const projectId = currentProject?.id

  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [labels, setLabels] = useState<Label[]>([])
  const [propertyDefs, setPropertyDefs] = useState<PropertyDef[]>([])
  const [loading, setLoading] = useState(true)
  const [labelFilter, setLabelFilter] = useState<string>(initialSelectedLabelId ?? ALL)
  const [query, setQuery] = useState("")
  const [nameSort, setNameSort] = useState<"none" | "asc" | "desc">("none")
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [filterState, setFilterState] = useState<"all" | ConfirmationState>("all")
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [showConfirm, setShowConfirm] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [unconfirming, setUnconfirming] = useState(false)

  // 追加
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState("")
  const [newLabelIds, setNewLabelIds] = useState<string[]>([])
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [addedNames, setAddedNames] = useState<string[]>([])
  const newNameRef = useRef<HTMLInputElement>(null)

  // 詳細
  const [editName, setEditName] = useState("")
  const [editLabelIds, setEditLabelIds] = useState<string[]>([])
  const [editValues, setEditValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [mergedChildren, setMergedChildren] = useState<GraphNode[]>([])

  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showBulkDelete, setShowBulkDelete] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null)

  // 名寄せ
  const [showNameCheck, setShowNameCheck] = useState(false)
  const [unmergingId, setUnmergingId] = useState<string | null>(null)

  const selected = useMemo(() => nodes.find((n) => n.id === selectedId) ?? null, [nodes, selectedId])
  const uncheckedCount = useMemo(() => nodes.filter((n) => !nameChecked(n)).length, [nodes])
  const labelById = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels])
  const labelName = useCallback((id: string) => labelById.get(id)?.name ?? "（削除済み）", [labelById])
  const sortedLabels = useMemo(
    () => [...labels].sort((a, b) => a.name.localeCompare(b.name, "ja")),
    [labels],
  )

  // ─── 取得 ───
  const fetchAll = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const [nodeList, labelList, props] = await Promise.all([
        fetch(`/api/nodes?projectId=${projectId}`).then((r) => r.json()),
        fetch(`/api/labels?projectId=${projectId}`).then((r) => r.json()),
        fetch(`/api/properties?projectId=${projectId}`).then((r) => r.json()),
      ])
      setNodes(Array.isArray(nodeList) ? nodeList : [])
      setLabels(Array.isArray(labelList) ? labelList : [])
      setPropertyDefs(Array.isArray(props) ? props : [])
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (projectLoading) return
    setNodes([]); setLabels([]); setPropertyDefs([])
    setSelectedId(null); setCheckedIds(new Set()); setLabelFilter(ALL)
    setLoading(!!projectId)
  }, [projectId, projectLoading])

  useEffect(() => {
    if (active && projectId) fetchAll()
  }, [active, projectId, fetchAll])

  useEffect(() => {
    if (!selected) { setMergedChildren([]); return }
    setEditName(selected.name)
    setEditLabelIds(selected.labelIds ?? [])
    setEditValues(selected.properties ?? {})
    setSaveError(null)
    fetch(`/api/nodes?projectId=${selected.projectId}&mergedInto=${selected.id}`)
      .then((r) => r.json())
      .then((d) => setMergedChildren(Array.isArray(d) ? d : []))
      .catch(() => setMergedChildren([]))
  }, [selected?.id])

  // ─── ラベルごとの件数（左ペイン） ───
  const labelCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    let unlabeled = 0
    for (const n of nodes) {
      const ids = n.labelIds ?? []
      if (ids.length === 0) unlabeled++
      for (const id of ids) counts[id] = (counts[id] ?? 0) + 1
    }
    return { counts, unlabeled }
  }, [nodes])

  // ─── 一覧 ───
  const visible = useMemo(() => {
    const q = normalizeName(query)
    return nodes
      .filter((n) =>
        labelFilter === ALL ? true
          : labelFilter === UNLABELED ? (n.labelIds ?? []).length === 0
            : (n.labelIds ?? []).includes(labelFilter),
      )
      .filter((n) => filterState === "all" || deriveConfirmationStatus(n.confirmations).state === filterState)
      .filter((n) => !q || normalizeName(n.name).includes(q))
  }, [nodes, labelFilter, filterState, query])

  // ノード名での並べ替え。見出しを押すたびに 昇順 → 降順 → 手動の並び に戻る。
  //   「ERL-01-2」と「ERL-01-10」が自然な順に並ぶよう、数字は数として比べる。
  const rows = useMemo(() => {
    if (nameSort === "none") return sortByOrder(visible)
    const sorted = [...visible].sort((a, b) =>
      a.name.localeCompare(b.name, "ja", { numeric: true, sensitivity: "base" }),
    )
    return nameSort === "asc" ? sorted : sorted.reverse()
  }, [visible, nameSort])
  // 名前で並べ替えている間は、手動の並び替え（ドラッグ）はさせない
  const canReorder = filterState === "all" && !query && nameSort === "none"

  // ─── このノードが持てるプロパティ（全ラベルの和集合＋プロジェクト共通） ───
  const applicableProps = useMemo(() => {
    const picked = new Map<string, PropertyDef>()
    for (const p of propertyDefs) {
      const belongs =
        p.targetType === "project" ||
        (p.targetType === "label" && editLabelIds.includes(p.targetId))
      if (!belongs) continue
      // 同名は同一のプロパティとして1つにまとめる（値のキーが名前のため）
      if (!picked.has(p.name)) picked.set(p.name, p)
    }
    return [...picked.values()].sort((a, b) => a.name.localeCompare(b.name, "ja"))
  }, [propertyDefs, editLabelIds])

  // そのプロパティがどのラベル由来か。同名が複数のラベルにあるときは全部並べる。
  const propSources = useMemo(() => {
    const byName = new Map<string, string[]>()
    for (const p of propertyDefs) {
      const from =
        p.targetType === "project"
          ? "プロジェクト共通"
          : p.targetType === "label" && editLabelIds.includes(p.targetId)
            ? labelById.get(p.targetId)?.name ?? "（削除済み）"
            : null
      if (!from) continue
      const list = byName.get(p.name) ?? []
      if (!list.includes(from)) list.push(from)
      byName.set(p.name, list)
    }
    return Object.fromEntries([...byName].map(([name, from]) => [name, from.join("・")]))
  }, [propertyDefs, editLabelIds, labelById])

  // 一覧に出すプロパティ列。
  //   「すべて」のときは出さない。ラベルごとにプロパティが違うので、全部まとめると
  //   列が増えすぎて表に収まらないため。ラベルで絞ったときだけ出す。
  //   出すのは【値が入っているキーだけ】。空欄ばかりの列を並べても読めないため。
  //   値のキーはプロパティ名なので、定義が消えていても値があれば出る。
  const columnKeys = useMemo(() => {
    if (labelFilter === ALL) return []
    const present = new Set<string>()
    for (const n of rows) {
      for (const [key, value] of Object.entries(n.properties ?? {})) {
        if (value !== "") present.add(key)
      }
    }
    return [...present].sort((a, b) => a.localeCompare(b, "ja"))
  }, [rows, labelFilter])

  // ─── 並べ替え ───
  const applyReorder = useCallback(async (updates: { id: string; order: number }[]) => {
    if (!projectId || updates.length === 0) return
    setNodes((prev) =>
      prev.map((n) => {
        const u = updates.find((x) => x.id === n.id)
        return u ? { ...n, order: u.order } : n
      }),
    )
    try {
      const res = await fetch("/api/nodes/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, updates }),
      })
      if (!res.ok) throw new Error("reorder failed")
    } catch (err) {
      console.error(err)
      fetchAll()
    }
  }, [projectId, fetchAll])

  const handleRowDrop = (activeId: string, overId: string) => {
    const moved = nodes.find((n) => n.id === activeId)
    if (!moved) return
    // 動かす行も含めた並びを渡す。下へ動かしたときに落とした行の位置へ入り、1つ手前に戻らないようにするため
    const { ordered, index } = placeAt(rows, moved, overId)
    // 前後に隙間があればその1件だけ、尽きていれば並び全体を振り直す
    const unnumbered = ordered.some((n) => n.order === undefined)
    const between = unnumbered ? null : orderBetween(ordered[index - 1], ordered[index + 1])
    applyReorder(
      between === null
        ? ordered.map((n, i) => ({ id: n.id, order: (i + 1) * ORDER_STEP }))
        : [{ id: ordered[index].id, order: between }],
    )
  }

  // ─── 追加 ───
  const openAddDialog = () => {
    setNewName("")
    setNewLabelIds(labelFilter !== ALL && labelFilter !== UNLABELED ? [labelFilter] : [])
    setAddError(null); setAddedNames([]); setShowAdd(true)
  }

  const handleAdd = async (keepOpen: boolean) => {
    if (!projectId || !newName.trim()) return
    setAdding(true); setAddError(null)
    try {
      const res = await fetch("/api/nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, name: newName.trim(), labelIds: newLabelIds, order: nextOrder(nodes),
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setAddError(err.error ?? "ノードの作成に失敗しました")
        return
      }
      const created: GraphNode = await res.json()
      setNodes((prev) => [...prev, created])
      if (keepOpen) {
        setAddedNames((prev) => [...prev, created.name])
        setNewName("")
        newNameRef.current?.focus()
      } else {
        setShowAdd(false)
        setSelectedId(created.id)
      }
    } finally {
      setAdding(false)
    }
  }

  // ─── 保存・削除 ───
  const dirty =
    !!selected &&
    (editName !== selected.name ||
      [...editLabelIds].sort().join("|") !== [...(selected.labelIds ?? [])].sort().join("|") ||
      JSON.stringify(editValues) !== JSON.stringify(selected.properties ?? {}))

  const handleSave = async () => {
    if (!selected || !editName.trim()) return
    setSaving(true); setSaveError(null)
    try {
      // 今のラベルで使えないプロパティの値は落とす（持ち主を外したら値も外れる）
      const allowed = new Set(applicableProps.map((p) => p.name))
      const values = Object.fromEntries(
        Object.entries(editValues).filter(([k, v]) => allowed.has(k) && v !== ""),
      )
      const res = await fetch(`/api/nodes/${selected.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim(), labelIds: editLabelIds, properties: values }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setSaveError(err.error ?? "保存に失敗しました")
        return
      }
      const updated: GraphNode = await res.json()
      setNodes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selected) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/nodes/${selected.id}`, { method: "DELETE" })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setSaveError(err.error ?? "削除に失敗しました")
        setShowDelete(false)
        return
      }
      setNodes((prev) => prev.filter((n) => n.id !== selected.id))
      setSelectedId(null)
      setShowDelete(false)
    } finally {
      setDeleting(false)
    }
  }

  // ─── まとめて削除 ───
  // 端になっているリレーションシップが残っているノードはサーバ側が弾く（409）。
  // 消せたものだけ一覧から外し、残った理由を出す。
  const handleBulkDelete = async () => {
    setBulkDeleting(true)
    setBulkDeleteError(null)
    try {
      const results = await Promise.all(
        targets.map((n) =>
          fetch(`/api/nodes/${n.id}`, { method: "DELETE" })
            .then((r) => ({ id: n.id, name: n.name, ok: r.ok })),
        ),
      )
      const removed = new Set(results.filter((r) => r.ok).map((r) => r.id))
      const failed = results.filter((r) => !r.ok)
      setNodes((prev) => prev.filter((n) => !removed.has(n.id)))
      if (selectedId && removed.has(selectedId)) setSelectedId(null)
      setCheckedIds(new Set())
      if (failed.length > 0) {
        setBulkDeleteError(
          `${failed.length}件はリレーションシップで使われているため削除できませんでした：`
          + failed.map((f) => f.name).join("、"),
        )
      } else {
        setShowBulkDelete(false)
      }
      fetchAll()
    } finally {
      setBulkDeleting(false)
    }
  }

  // ─── 名寄せの統合解除 ───
  const handleUnmerge = async (nodeId: string) => {
    if (!projectId) return
    setUnmergingId(nodeId)
    try {
      const res = await fetch("/api/nodes/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, action: "unmerge", nodeId }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setSaveError(err.error ?? "統合の解除に失敗しました")
        return
      }
      setMergedChildren((prev) => prev.filter((m) => m.id !== nodeId))
      fetchAll()
    } finally {
      setUnmergingId(null)
    }
  }

  // ─── 確認（承認） ───
  const targets = useMemo(() => nodes.filter((n) => checkedIds.has(n.id)), [nodes, checkedIds])
  const canBulkConfirm = targets.some((n) => deriveConfirmationStatus(n.confirmations).state !== "confirmed")
  const canBulkUnconfirm = targets.some((n) => deriveConfirmationStatus(n.confirmations).state !== "unconfirmed")

  const applyConfirmations = (updated: (GraphNode | null)[]) => {
    const ok = updated.filter((n): n is GraphNode => n !== null)
    const byId = new Map(ok.map((n) => [n.id, n]))
    setNodes((prev) => prev.map((n) => byId.get(n.id) ?? n))
    setCheckedIds(new Set())
  }

  const handleConfirm = async (confirmerName: string) => {
    setConfirming(true)
    try {
      const updated = await Promise.all(
        targets.map((n) =>
          fetch(`/api/nodes/${n.id}/confirmations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ confirmerName }),
          }).then((r) => (r.ok ? r.json() : null)),
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
        targets.map((n) =>
          fetch(`/api/nodes/${n.id}/confirmations`, { method: "DELETE" })
            .then((r) => (r.ok ? r.json() : null)),
        ),
      )
      applyConfirmations(updated)
    } finally {
      setUnconfirming(false)
    }
  }

  // ラベルのチップ（詳細・追加ダイアログで共用）
  const renderLabelPicker = (
    value: string[],
    onChange: (next: string[]) => void,
  ) => (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {value.length === 0 && (
          <span className="text-xs text-muted-foreground">ラベルなし</span>
        )}
        {value.map((id) => (
          <LabelChip
            key={id}
            name={labelName(id)}
            icon={labelById.get(id)?.system ? <Lock className="h-3 w-3 shrink-0" /> : undefined}
            onRemove={() => onChange(value.filter((v) => v !== id))}
          />
        ))}
      </div>
      <Select value="" onValueChange={(v) => { if (v && !value.includes(v)) onChange([...value, v]) }}>
        <SelectTrigger className="h-8">
          <SelectValue>ラベルを追加</SelectValue>
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {sortedLabels.filter((l) => !value.includes(l.id)).map((l) => (
            <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )

  return (
    <div className="flex h-full flex-col">
      <TopBar group="グラフデータ作成" title="ノード管理">
        {!loading && currentProject && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>ノード {nodes.length}</span>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-transparent"
              onClick={() => setShowNameCheck(true)}>
              <Merge className="h-3.5 w-3.5" />
              名寄せ
              {uncheckedCount > 0 && (
                <Badge variant="secondary" className="ml-0.5 h-5 px-1.5 font-normal">
                  未{uncheckedCount}
                </Badge>
              )}
            </Button>
          </div>
        )}
      </TopBar>

      <div className="flex flex-1 overflow-hidden">
        {/* 左：ラベルで絞り込む */}
        <div className="flex w-64 shrink-0 flex-col overflow-hidden border-r border-border">
          <div className="px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">ラベル</h2>
          </div>
          <div className="flex items-center justify-between px-4.5 pb-1 text-xs text-muted-foreground">
            <span>ラベル名</span>
            <span>ノード数</span>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-4">
            {([
              { id: ALL, name: "すべて", count: nodes.length },
              { id: UNLABELED, name: "ラベルなし", count: labelCounts.unlabeled },
            ]).map((item) => (
              <button key={item.id} type="button"
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                  labelFilter === item.id ? "bg-indigo-100 text-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-100" : "hover:bg-muted",
                )}
                onClick={() => setLabelFilter(item.id)}>
                <span className="truncate">{item.name}</span>
                <span className="ml-2 shrink-0 text-xs text-muted-foreground">{item.count}</span>
              </button>
            ))}
            <div className="my-2 border-t border-border" />
            {sortedLabels.map((l) => (
              <button key={l.id} type="button"
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                  labelFilter === l.id ? "bg-indigo-100 text-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-100" : "hover:bg-muted",
                )}
                onClick={() => setLabelFilter(l.id)}>
                <span className="flex min-w-0 items-center gap-1">
                  {l.system && <Lock className="h-3 w-3 shrink-0 text-muted-foreground/60" />}
                  <span className="truncate">{l.name}</span>
                </span>
                <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                  {labelCounts.counts[l.id] ?? 0}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* 中央：ノード一覧 */}
        <div className="flex flex-1 flex-col overflow-hidden border-r border-border">
          <div className="flex items-center justify-between gap-3 px-6 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <h2 className="shrink-0 text-base font-semibold text-foreground">
                {labelFilter === ALL ? "すべてのノード"
                  : labelFilter === UNLABELED ? "ラベルなしのノード"
                    : `${labelName(labelFilter)} のノード`}
              </h2>
              <div className="relative w-56">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder="ノード名で検索" className="h-8 pl-7" />
              </div>
            </div>
            <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1.5 bg-transparent"
              onClick={openAddDialog} disabled={!currentProject}>
              <Plus className="h-3.5 w-3.5" />ノードを追加
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
            {!canReorder && (
              <span className="text-muted-foreground">
                {nameSort !== "none" ? "（ノード名で並べている間は並べ替えできません）" : "（絞り込み中は並べ替えできません）"}
              </span>
            )}
          </div>

          {checkedIds.size > 0 && (
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
              <Button size="sm" variant="outline"
                className="h-7 gap-1.5 bg-transparent text-muted-foreground hover:text-destructive"
                onClick={() => { setBulkDeleteError(null); setShowBulkDelete(true) }}>
                <Trash2 className="h-3.5 w-3.5" />削除する
              </Button>
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col px-6 pb-6">
            {loading && nodes.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : rows.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">
                {!currentProject ? "プロジェクトを選択してください"
                  : nodes.length === 0 ? "ノードが登録されていません" : "条件に合うノードがありません"}
              </p>
            ) : (
              <ListDndContext
                onDrop={handleRowDrop}
                labelOf={(id) => (
                  <span className="font-medium text-foreground">
                    {nodes.find((n) => n.id === id)?.name ?? id}
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
                          <input type="checkbox" aria-label="表示中のノードをすべて選択"
                            checked={rows.length > 0 && rows.every((n) => checkedIds.has(n.id))}
                            onChange={(e) => {
                              const next = new Set(checkedIds)
                              if (e.target.checked) rows.forEach((n) => next.add(n.id))
                              else rows.forEach((n) => next.delete(n.id))
                              setCheckedIds(next)
                            }} />
                        </TableHead>
                        <TableHead className="font-semibold text-foreground">
                          <button type="button"
                            className="inline-flex items-center gap-1 transition-colors hover:text-foreground/70"
                            aria-label="ノード名で並べ替え"
                            onClick={() => setNameSort((s) => (s === "none" ? "asc" : s === "asc" ? "desc" : "none"))}>
                            ノード名
                            {nameSort === "asc" ? <ArrowUp className="h-3.5 w-3.5" />
                              : nameSort === "desc" ? <ArrowDown className="h-3.5 w-3.5" />
                                : <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/50" />}
                          </button>
                        </TableHead>
                        <TableHead className="font-semibold text-foreground">ラベル</TableHead>
                        {columnKeys.map((key) => (
                          <TableHead key={key} className="max-w-40 font-semibold text-foreground">
                            {key}
                          </TableHead>
                        ))}
                        <TableHead className="w-20 font-semibold text-foreground">名寄せ</TableHead>
                        <TableHead className="w-32 font-semibold text-foreground">登録確認</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((n) => {
                        const status = deriveConfirmationStatus(n.confirmations)
                        return (
                          <DragRow key={n.id} id={n.id} label={n.name} enabled={canReorder}
                            className={cn(
                              "cursor-pointer transition-colors",
                              selectedId === n.id
                                ? "bg-indigo-100 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-950/50"
                                : "hover:bg-muted/50",
                            )}
                            onClick={() => setSelectedId(n.id)}>
                            <TableCell className="align-top" onClick={(e) => e.stopPropagation()}>
                              <input type="checkbox" aria-label={`${n.name}を選択`}
                                checked={checkedIds.has(n.id)}
                                onChange={() => setCheckedIds((prev) => toggleIn(prev, n.id))} />
                            </TableCell>
                            <TableCell className="align-top font-medium text-foreground">{n.name}</TableCell>
                            <TableCell className="align-top">
                              <LabelChips names={(n.labelIds ?? []).map(labelName)} />
                            </TableCell>
                            {columnKeys.map((key) => (
                              <TableCell key={key} className="max-w-40 align-top text-sm text-muted-foreground">
                                <span className="block truncate" title={n.properties?.[key] ?? ""}>
                                  {n.properties?.[key] || "—"}
                                </span>
                              </TableCell>
                            ))}
                            <TableCell className="align-top">
                              <Badge variant={nameChecked(n) ? "secondary" : "outline"} className="font-normal">
                                {nameChecked(n) ? "済" : "未"}
                              </Badge>
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

        {/* 右：詳細 */}
        {selected && (
          <div className="flex w-[30rem] shrink-0 flex-col overflow-hidden bg-card">
            <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
              <section className="space-y-3">
                <SectionHeader icon={FileText} title="基本情報" />
                <div className="space-y-3">
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <ConfirmationSummary events={selected.confirmations} fieldLabels={NODE_FIELD_LABEL} />
                    <p>登録日 {formatDateTime(selected.registeredAt)}{selected.registeredBy ? `（${selected.registeredBy}）` : ""}</p>
                    <p>更新日 {formatDateTime(selected.updatedAt)}{selected.updatedBy ? `（${selected.updatedBy}）` : ""}</p>
                    <p>名寄せチェック {nameChecked(selected) ? "済" : "未"}</p>
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel className="text-sm font-medium">
                      ノード名 <span className="text-destructive">*</span>
                    </FieldLabel>
                    <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-8" />
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel className="text-sm font-medium">ラベル</FieldLabel>
                    {renderLabelPicker(editLabelIds, setEditLabelIds)}
                    <p className="text-xs text-muted-foreground">
                      上位・下位をまとめたいときは、上位のラベルも付けてください。
                      リレーションシップタイプは、ノードが持つラベルで使えるかどうかが決まります。
                    </p>
                  </div>
                  {saveError && <p className="text-xs text-destructive">{saveError}</p>}
                </div>
              </section>

              <section className="space-y-3">
                <SectionHeader icon={Tags} title="プロパティ" />
                {applicableProps.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border py-3 text-center text-xs text-muted-foreground">
                    付与されたラベルにプロパティが定義されていません
                  </p>
                ) : (
                  <PropertyValueList
                    properties={applicableProps}
                    values={editValues}
                    sources={propSources}
                    onChange={(name, v) => setEditValues((prev) => ({ ...prev, [name]: v }))}
                  />
                )}
                <p className="text-xs text-muted-foreground">
                  付与された全ラベルのプロパティの和集合です。定義の追加・編集はラベル管理で行います。
                </p>
              </section>

              {mergedChildren.length > 0 && (
                <section className="space-y-3">
                  <SectionHeader icon={Merge} title="統合済み（別名）" />
                  <div className="space-y-1.5">
                    {mergedChildren.map((m) => (
                      <div key={m.id}
                        className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm">
                        <span className="min-w-0 flex-1 truncate text-foreground">{m.name}</span>
                        <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 text-xs"
                          onClick={() => handleUnmerge(m.id)} disabled={unmergingId === m.id}>
                          {unmergingId === m.id
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <Undo2 className="h-3 w-3" />}
                          統合を解除
                        </Button>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    名寄せで統合した別名です。解除すると未チェックのノードとして戻りますが、
                    付け替えたリレーションシップは戻りません。
                  </p>
                </section>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-destructive"
                onClick={() => setShowDelete(true)}>
                <Trash2 className="h-3.5 w-3.5" />削除
              </Button>
              <div className="flex items-center gap-2">
                {hasMissingRequired(applicableProps, editValues) && (
                  <Tooltip content="必須のプロパティが空です（保存はできます）">
                    <span className="text-xs text-amber-600 dark:text-amber-500">必須未入力</span>
                  </Tooltip>
                )}
                <Button size="sm" className="gap-1.5" onClick={handleSave}
                  disabled={!dirty || saving || !editName.trim()}>
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}保存
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ノード追加 */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>ノードを追加</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <FieldLabel className="text-sm font-medium">
                ノード名 <span className="text-destructive">*</span>
              </FieldLabel>
              <Input ref={newNameRef} value={newName} onChange={(e) => setNewName(e.target.value)}
                className="h-8" placeholder="例：ERL-01-01" autoFocus />
            </div>
            <div className="space-y-1.5">
              <FieldLabel className="text-sm font-medium">ラベル</FieldLabel>
              {renderLabelPicker(newLabelIds, setNewLabelIds)}
            </div>
            {addError && <p className="text-xs text-destructive">{addError}</p>}
            {addedNames.length > 0 && (
              <p className="text-xs text-muted-foreground">追加済み：{addedNames.join("、")}</p>
            )}
            <p className="text-xs text-muted-foreground">
              プロパティの値は、追加したあと右の詳細パネルで入力します。
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>閉じる</Button>
            <Button variant="outline" onClick={() => handleAdd(true)} disabled={adding || !newName.trim()}>
              {adding && <Loader2 className="h-3.5 w-3.5 animate-spin" />}追加して続ける
            </Button>
            <Button onClick={() => handleAdd(false)} disabled={adding || !newName.trim()}>
              {adding && <Loader2 className="h-3.5 w-3.5 animate-spin" />}追加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 削除確認 */}
      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>ノードを削除</DialogTitle></DialogHeader>
          <p className="text-sm">
            「{selected?.name}」を削除します。この操作は取り消せません。
          </p>
          <p className="text-xs text-muted-foreground">
            このノードが端になっているリレーションシップが残っている場合は削除できません。
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)} disabled={deleting}>キャンセル</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}削除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* まとめて削除 */}
      <Dialog open={showBulkDelete} onOpenChange={setShowBulkDelete}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>ノードをまとめて削除</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            <p>{targets.length}件のノードを削除します。この操作は取り消せません。</p>
            <p className="max-h-32 overflow-y-auto text-xs text-muted-foreground">
              {targets.map((n) => n.name).join("、")}
            </p>
            <p className="text-xs text-muted-foreground">
              リレーションシップの端になっているノードは削除できません。残ったものは理由を出します。
            </p>
            {bulkDeleteError && <p className="text-xs text-destructive">{bulkDeleteError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkDelete(false)} disabled={bulkDeleting}>
              閉じる
            </Button>
            <Button variant="destructive" onClick={handleBulkDelete} disabled={bulkDeleting || targets.length === 0}>
              {bulkDeleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}削除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={showConfirm} onOpenChange={setShowConfirm}
        title="ノードを確認"
        description={`${checkedIds.size}件のノードに確認レコードを追加します。`}
        submitting={confirming} onSubmit={handleConfirm} />

      <NodeNameCheckDialog
        open={showNameCheck}
        onOpenChange={setShowNameCheck}
        projectId={projectId ?? null}
        labels={labels}
        onResolved={fetchAll}
      />
    </div>
  )
}
