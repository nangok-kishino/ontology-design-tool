"use client"

// ラベル管理（スキーマ設計）。
//   旧クラス管理の後継だが、ラベルは親子関係を持たないので木ではなく平らな一覧になる。
//   上位・下位の関係は、ノードに両方のラベルを付けることで表す（docs/graph-model.md）。
//   グループは移行元のクラスと同じ一覧（Project.classGroups）をそのまま使う。

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
import { SynonymInput } from "@/components/synonym-input"
import { PropertySection, type PropertySectionHandle } from "@/components/property-section"
import { cn } from "@/lib/utils"
import { UNGROUPED, nextOrder, placeAt, reorderUpdates, sortByOrder, sortGroups } from "@/lib/organize"
import { deriveConfirmationStatus, type ConfirmationState } from "@/lib/confirmation"
import { LABEL_FIELD_LABEL } from "@/lib/graph-confirmation"
import type { Label, PropertyDef } from "@/lib/graph-types"
import {
  CheckCircle2, ChevronDown, ChevronRight, FileText, Info, Loader2, Lock, Plus, Tags, Trash2, X,
} from "lucide-react"
import { useProject } from "@/app/project-context"

// グループ見出し行の id。落とし先としてラベルの id と区別するために前置きする。
const GROUP_ROW_PREFIX = "group:"

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
  | { kind: "label"; key: string; label: Label }

export function LabelsScreen({ initialSelectedId, active }: { initialSelectedId?: string; active?: boolean }) {
  const { currentProject, loading: projectLoading } = useProject()
  const projectId = currentProject?.id

  const [labels, setLabels] = useState<Label[]>([])
  const [nodeCounts, setNodeCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null)

  const { groups, setGroups, refresh: refreshGroups } = useGroups(projectId, "class")
  const [showGroupManager, setShowGroupManager] = useState(false)
  const [viewMode, setViewMode] = useState<BoardViewMode>("list")
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<Set<string>>(new Set())

  // 確認（承認）
  const [filterState, setFilterState] = useState<"all" | ConfirmationState>("all")
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [showConfirm, setShowConfirm] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [unconfirming, setUnconfirming] = useState(false)

  // 追加ダイアログ
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState("")
  const [newNameEn, setNewNameEn] = useState("")
  const [newSynonyms, setNewSynonyms] = useState<string[]>([])
  const [newDesc, setNewDesc] = useState("")
  const [newGroupId, setNewGroupId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [addedNames, setAddedNames] = useState<string[]>([])
  const newNameRef = useRef<HTMLInputElement>(null)

  // 詳細パネル（常時編集可）
  const [editName, setEditName] = useState("")
  const [editNameEn, setEditNameEn] = useState("")
  const [editSynonyms, setEditSynonyms] = useState<string[]>([])
  const [editDesc, setEditDesc] = useState("")
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // ラベルグループ・プロパティも、下の「保存」を押すまでは保留にする
  const [editGroupId, setEditGroupId] = useState<string | null>(null)
  const [propsDirty, setPropsDirty] = useState(false)
  const propertyRef = useRef<PropertySectionHandle>(null)

  // 削除
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showBulkDelete, setShowBulkDelete] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const selected = useMemo(() => labels.find((l) => l.id === selectedId) ?? null, [labels, selectedId])

  // ─── 取得 ───
  const fetchLabels = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const [list, counts] = await Promise.all([
        fetch(`/api/labels?projectId=${projectId}`).then((r) => r.json()),
        fetch(`/api/labels/counts?projectId=${projectId}`).then((r) => r.json()).catch(() => ({ counts: {} })),
      ])
      setLabels(Array.isArray(list) ? list : [])
      setNodeCounts(counts?.counts ?? {})
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (projectLoading) return
    setLabels([]); setNodeCounts({}); setSelectedId(null); setCheckedIds(new Set())
    setLoading(!!projectId)
  }, [projectId, projectLoading])

  useEffect(() => {
    if (active && projectId) {
      fetchLabels()
      refreshGroups()
    }
  }, [active, projectId, fetchLabels, refreshGroups])

  // 選択したラベルの内容を編集欄へ流し込む
  useEffect(() => {
    if (!selected) return
    setEditName(selected.name)
    setEditNameEn(selected.nameEn ?? "")
    setEditSynonyms(selected.synonyms ?? [])
    setEditDesc(selected.description ?? "")
    setEditGroupId(selected.groupId ?? null)
    setPropsDirty(false)
    setSaveError(null)
  }, [selected?.id])

  // ─── 並び・グループ ───
  const knownGroupIds = useMemo(() => new Set(groups.map((g) => g.id)), [groups])
  const groupKeyOf = useCallback(
    (l: Label) => (l.groupId && knownGroupIds.has(l.groupId) ? l.groupId : UNGROUPED),
    [knownGroupIds],
  )

  const visible = useMemo(() => {
    if (filterState === "all") return labels
    return labels.filter((l) => deriveConfirmationStatus(l.confirmations).state === filterState)
  }, [labels, filterState])

  const canReorder = filterState === "all" && viewMode === "list"

  const listRows = useMemo<ListRow[]>(() => {
    const buckets = new Map<string, Label[]>()
    for (const l of visible) {
      const key = groupKeyOf(l)
      const list = buckets.get(key)
      if (list) list.push(l)
      else buckets.set(key, [l])
    }
    const rows: ListRow[] = []
    const emit = (groupKey: string, name: string, color?: string) => {
      const items = sortByOrder(buckets.get(groupKey) ?? [])
      rows.push({ kind: "group", key: GROUP_ROW_PREFIX + groupKey, groupKey, name, color, count: items.length })
      if (collapsedGroupKeys.has(groupKey)) return
      for (const l of items) rows.push({ kind: "label", key: l.id, label: l })
    }
    for (const g of sortGroups(groups)) emit(g.id, g.name, g.color)
    emit(UNGROUPED, "未分類")
    return rows
  }, [visible, groups, groupKeyOf, collapsedGroupKeys])

  const boardItems = useMemo<BoardItem[]>(
    () => visible.map((l) => ({
      id: l.id, name: l.name, nameEn: l.nameEn,
      groupId: groupKeyOf(l) === UNGROUPED ? null : l.groupId, order: l.order, createdAt: l.createdAt,
    })),
    [visible, groupKeyOf],
  )

  // 保存できたかを返す（ボードはこれを見て、失敗したら自分の表示を元に戻す）
  const applyReorder = useCallback(async (updates: ReorderUpdate[]): Promise<boolean> => {
    if (!projectId || updates.length === 0) return false
    setLabels((prev) =>
      prev.map((l) => {
        const u = updates.find((x) => x.id === l.id)
        return u ? { ...l, order: u.order, groupId: u.groupId } : l
      }),
    )
    try {
      const res = await fetch("/api/labels/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, updates }),
      })
      if (!res.ok) throw new Error("reorder failed")
      return true
    } catch (err) {
      console.error(err)
      fetchLabels()
      return false
    }
  }, [projectId, fetchLabels])

  const handleRowDrop = (activeId: string, overId: string) => {
    const moved = labels.find((l) => l.id === activeId)
    if (!moved) return
    let targetKey: string
    let overLabelId: string | undefined
    if (overId.startsWith(GROUP_ROW_PREFIX)) {
      targetKey = overId.slice(GROUP_ROW_PREFIX.length)
    } else {
      const over = labels.find((l) => l.id === overId)
      if (!over) return
      targetKey = groupKeyOf(over)
      overLabelId = overId
    }
    // 同じグループ内の移動なら、動かす行も含めた並びを渡す（下へ動かしたときに1つ手前に戻らないように）。
    // 別グループからの移動なら含まれないので、落とした行の前に入る
    const list = sortByOrder(labels.filter((l) => groupKeyOf(l) === targetKey))
    const { ordered, index } = placeAt(list, moved, overLabelId)
    applyReorder(reorderUpdates(ordered, index, targetKey === UNGROUPED ? null : targetKey))
  }

  // ─── 追加 ───
  const openAddDialog = () => {
    setNewName(""); setNewNameEn(""); setNewSynonyms([]); setNewDesc("")
    setNewGroupId(null)
    setAddError(null); setAddedNames([]); setShowAdd(true)
  }

  const handleAdd = async (keepOpen: boolean) => {
    if (!projectId || !newName.trim()) return
    setAdding(true); setAddError(null)
    try {
      const res = await fetch("/api/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, name: newName.trim(), nameEn: newNameEn.trim(),
          synonyms: newSynonyms, description: newDesc,
          groupId: newGroupId,
          // 選んだグループの末尾に置く
          order: nextOrder(labels.filter((l) => groupKeyOf(l) === (newGroupId ?? UNGROUPED))),
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setAddError(err.error ?? "ラベルの作成に失敗しました")
        return
      }
      const created: Label = await res.json()
      setLabels((prev) => [...prev, created])
      if (keepOpen) {
        setAddedNames((prev) => [...prev, created.name])
        setNewName(""); setNewNameEn(""); setNewSynonyms([]); setNewDesc("")
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
  // 右ペインの変更（基本情報・ラベルグループ・プロパティ）は、下の「保存」でまとめて書き込む
  const basicDirty =
    !!selected &&
    (editName !== selected.name ||
      editNameEn !== (selected.nameEn ?? "") ||
      editDesc !== (selected.description ?? "") ||
      editSynonyms.join("\n") !== (selected.synonyms ?? []).join("\n"))
  const groupDirty = !!selected && (editGroupId ?? null) !== (selected.groupId ?? null)
  const dirty = basicDirty || groupDirty || propsDirty

  const handleSave = async () => {
    if (!selected || !editName.trim()) return
    setSaving(true); setSaveError(null)
    try {
      if (basicDirty) {
        const res = await fetch(`/api/labels/${selected.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: editName.trim(), nameEn: editNameEn.trim(),
            synonyms: editSynonyms, description: editDesc,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          setSaveError(err.error ?? "保存に失敗しました")
          return
        }
        const updated: Label = await res.json()
        setLabels((prev) => prev.map((l) => (l.id === updated.id ? updated : l)))
      }
      if (groupDirty) {
        // 移した先のグループの末尾に置く
        const key = editGroupId ?? UNGROUPED
        const list = sortByOrder(labels.filter((l) => groupKeyOf(l) === key && l.id !== selected.id))
        const ok = await applyReorder([{ id: selected.id, order: nextOrder(list), groupId: editGroupId }])
        if (!ok) { setSaveError("ラベルグループの変更に失敗しました"); return }
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
      const res = await fetch(`/api/labels/${selected.id}`, { method: "DELETE" })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setSaveError(err.error ?? "削除に失敗しました")
        return
      }
      setLabels((prev) => prev.filter((l) => l.id !== selected.id))
      setSelectedId(null)
      setShowDelete(false)
      fetchLabels()
    } finally {
      setDeleting(false)
    }
  }

  // ─── 確認（承認） ───
  const targets = useMemo(() => labels.filter((l) => checkedIds.has(l.id)), [labels, checkedIds])
  const canBulkConfirm = targets.some((l) => deriveConfirmationStatus(l.confirmations).state !== "confirmed")
  const canBulkUnconfirm = targets.some((l) => deriveConfirmationStatus(l.confirmations).state !== "unconfirmed")
  // 予約ラベルは削除できないので、まとめて消す対象からも外す
  const deletableTargets = useMemo(() => targets.filter((l) => !l.system), [targets])
  const bulkDeleteNodeCount = useMemo(
    () => deletableTargets.reduce((n, l) => n + (nodeCounts[l.id] ?? 0), 0),
    [deletableTargets, nodeCounts],
  )

  const handleBulkDelete = async () => {
    setBulkDeleting(true)
    try {
      const results = await Promise.all(
        deletableTargets.map((l) =>
          fetch(`/api/labels/${l.id}`, { method: "DELETE" }).then((r) => (r.ok ? l.id : null)),
        ),
      )
      const removed = new Set(results.filter((id): id is string => id !== null))
      setLabels((prev) => prev.filter((l) => !removed.has(l.id)))
      if (selectedId && removed.has(selectedId)) setSelectedId(null)
      setCheckedIds(new Set())
      setShowBulkDelete(false)
      fetchLabels()
    } finally {
      setBulkDeleting(false)
    }
  }

  const handleConfirm = async (confirmerName: string) => {
    setConfirming(true)
    try {
      const updated = await Promise.all(
        targets.map((l) =>
          fetch(`/api/labels/${l.id}/confirmations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ confirmerName }),
          }).then((r) => (r.ok ? r.json() : null)),
        ),
      )
      const byId = new Map(updated.filter(Boolean).map((l: Label) => [l.id, l]))
      setLabels((prev) => prev.map((l) => byId.get(l.id) ?? l))
      setShowConfirm(false)
      setCheckedIds(new Set())
    } finally {
      setConfirming(false)
    }
  }

  const handleUnconfirm = async () => {
    setUnconfirming(true)
    try {
      const updated = await Promise.all(
        targets.map((l) =>
          fetch(`/api/labels/${l.id}/confirmations`, { method: "DELETE" }).then((r) => (r.ok ? r.json() : null)),
        ),
      )
      const byId = new Map(updated.filter(Boolean).map((l: Label) => [l.id, l]))
      setLabels((prev) => prev.map((l) => byId.get(l.id) ?? l))
      setCheckedIds(new Set())
    } finally {
      setUnconfirming(false)
    }
  }

  const labelRows = listRows.filter((r): r is Extract<ListRow, { kind: "label" }> => r.kind === "label")

  return (
    <div className="flex h-full flex-col">
      <TopBar group="スキーマ設計" title="ラベル管理">
        {!loading && currentProject && (
          <span className="text-xs text-muted-foreground">
            ラベル {labels.length}
          </span>
        )}
      </TopBar>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden border-r border-border">
          <div className="flex items-center justify-between gap-3 px-6 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <h2 className="shrink-0 text-base font-semibold text-foreground">ラベル一覧</h2>
              <ViewToggle value={viewMode} onChange={setViewMode} />
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
              onClick={openAddDialog} disabled={!currentProject}>
              <Plus className="h-3.5 w-3.5" />ラベルを追加
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
              {deletableTargets.length > 0 && (
                <Button size="sm" variant="outline"
                  className="h-7 gap-1.5 bg-transparent text-muted-foreground hover:text-destructive"
                  onClick={() => setShowBulkDelete(true)}>
                  <Trash2 className="h-3.5 w-3.5" />削除する
                </Button>
              )}
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col px-6 pb-6">
            {loading && labels.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : labels.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">
                {currentProject ? "ラベルが登録されていません" : "プロジェクトを選択してください"}
              </p>
            ) : viewMode === "board" ? (
              // ボードは自前でレーンを横スクロールする

              <GroupBoard
                items={boardItems}
                groups={groups}
                selectedId={selectedId}
                onSelect={(id) => setSelectedId((prev) => (prev === id ? null : id))}
                onReorder={applyReorder}
              />
            ) : (
              <ListDndContext
                onDrop={handleRowDrop}
                labelOf={(id) => (
                  <span className="font-medium text-foreground">
                    {labels.find((l) => l.id === id)?.name ?? id}
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
                          <input
                            type="checkbox"
                            aria-label="表示中のラベルをすべて選択"
                            checked={labelRows.length > 0 && labelRows.every((r) => checkedIds.has(r.label.id))}
                            onChange={(e) => {
                              const next = new Set(checkedIds)
                              if (e.target.checked) labelRows.forEach((r) => next.add(r.label.id))
                              else labelRows.forEach((r) => next.delete(r.label.id))
                              setCheckedIds(next)
                            }}
                          />
                        </TableHead>
                        <TableHead className="font-semibold text-foreground">ラベル名</TableHead>
                        <TableHead className="w-20 font-semibold text-foreground">利用数</TableHead>
                        <TableHead className="w-32 font-semibold text-foreground">登録確認</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {listRows.map((row) => {
                        if (row.kind === "group") {
                          return (
                            <DropRow key={row.key} id={row.key} enabled={canReorder}
                              className="bg-muted/40 hover:bg-muted/40">
                              <TableCell colSpan={5} className="py-1.5">
                                <button
                                  type="button"
                                  aria-label={`${row.name}を${collapsedGroupKeys.has(row.groupKey) ? "開く" : "閉じる"}`}
                                  onClick={() => setCollapsedGroupKeys((prev) => toggleIn(prev, row.groupKey))}
                                  className="flex items-center gap-2 text-xs font-semibold text-foreground"
                                >
                                  {collapsedGroupKeys.has(row.groupKey)
                                    ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                    : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                                  <span className="h-2.5 w-2.5 rounded-full border border-border"
                                    style={row.color ? { backgroundColor: row.color } : undefined} />
                                  <span className="font-normal text-muted-foreground">ラベルグループ：</span>
                                  {row.name}
                                  <span className="font-normal text-muted-foreground">{row.count}件</span>
                                </button>
                              </TableCell>
                            </DropRow>
                          )
                        }
                        const l = row.label
                        const status = deriveConfirmationStatus(l.confirmations)
                        const isSel = selectedId === l.id
                        return (
                          <DragRow
                            key={row.key}
                            id={l.id}
                            label={l.name}
                            enabled={canReorder}
                            className={cn(
                              "cursor-pointer transition-colors",
                              isSel
                                ? "bg-indigo-100 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-950/50"
                                : "hover:bg-muted/50",
                            )}
                            onClick={() => setSelectedId(l.id)}
                          >
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                aria-label={`${l.name}を選択`}
                                checked={checkedIds.has(l.id)}
                                onChange={() => setCheckedIds((prev) => toggleIn(prev, l.id))}
                              />
                            </TableCell>
                            <TableCell className="font-medium text-foreground">
                              <span className="flex flex-col">
                                <span className="flex items-center gap-1.5">
                                  {l.name}
                                  {l.system && (
                                    <Tooltip content="予約ラベル。カテゴリノードを個体と区別するために使います">
                                      <Lock className="h-3 w-3 text-muted-foreground/60" />
                                    </Tooltip>
                                  )}
                                </span>
                                {l.nameEn && <span className="text-xs font-normal text-muted-foreground">{l.nameEn}</span>}
                              </span>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {nodeCounts[l.id] ?? 0}
                            </TableCell>
                            <TableCell>
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

        {/* 詳細（常に編集可）。非選択のときは出さず、一覧・ボードを全幅にする */}
        {selected && (
          <div className="flex w-[30rem] shrink-0 flex-col overflow-hidden bg-card">
            <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
              <section className="space-y-3">
                <SectionHeader icon={FileText} title="基本情報" />
                <div className="space-y-3">
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <ConfirmationSummary events={selected.confirmations} fieldLabels={LABEL_FIELD_LABEL} />
                    <p>登録日 {formatDateTime(selected.createdAt)}{selected.createdBy ? `（${selected.createdBy}）` : ""}</p>
                    <p>更新日 {formatDateTime(selected.updatedAt)}{selected.updatedBy ? `（${selected.updatedBy}）` : ""}</p>
                    <p>このラベルが付いているノード {nodeCounts[selected.id] ?? 0}件</p>
                  </div>

                  {selected.system && (
                    <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      予約ラベルです。カテゴリノード（「支柱」のような種類そのものを表すノード）を
                      個体と区別するために使います。名前の変更と削除はできません。
                    </p>
                  )}

                  <div className="space-y-1.5">
                    <FieldLabel className="text-sm font-medium">
                      ラベル名（日本語名） <span className="text-destructive">*</span>
                    </FieldLabel>
                    <Input value={editName} onChange={(e) => setEditName(e.target.value)}
                      disabled={!!selected.system} placeholder="例：不具合事例" className="h-8" />
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel className="text-sm font-medium">ラベル名（英語名）</FieldLabel>
                    <Input value={editNameEn} onChange={(e) => setEditNameEn(e.target.value)}
                      placeholder="例：Defect Case" className="h-8" />
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel className="text-sm font-medium">ラベル同義語</FieldLabel>
                    <SynonymInput value={editSynonyms} onChange={setEditSynonyms} ownName={editName} />
                    <p className="text-xs text-muted-foreground">
                      文書中でこのラベルを指す別の呼び方。抽出時に読み替えます
                      （例：商品ラベルの「製品」→「製品名：アクトチェア」を商品として登録）。
                      個体の言い換えである「別名」はノード名寄せで扱います。
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel className="text-sm font-medium">説明</FieldLabel>
                    <Textarea rows={4} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel className="text-sm font-medium">ラベルグループ</FieldLabel>
                    <Select
                      value={editGroupId ?? "__none__"}
                      onValueChange={(v) => setEditGroupId(!v || v === "__none__" ? null : v)}
                    >
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
                <SectionHeader icon={Tags} title="プロパティ" />
                {projectId && (
                  <PropertySection
                    key={selected.id}
                    ref={propertyRef}
                    projectId={projectId}
                    targetType="label"
                    targetId={selected.id}
                    onDirtyChange={setPropsDirty}
                    note="ノードが持てるプロパティは、付与された全ラベルのプロパティの和集合になります。"
                  />
                )}
              </section>
            </div>

            {saveError && (
              <p className="border-t border-border px-4 pt-2 text-xs text-destructive">{saveError}</p>
            )}
            <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-destructive"
                onClick={() => setShowDelete(true)} disabled={!!selected.system}>
                <Trash2 className="h-3.5 w-3.5" />削除
              </Button>
              <div className="flex items-center gap-2">
                {dirty && <span className="text-xs text-amber-600 dark:text-amber-500">未保存の変更があります</span>}
                <Button size="sm" className="gap-1.5" onClick={handleSave} disabled={!dirty || saving || !editName.trim()}>
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}保存
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ラベル追加 */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>ラベルを追加</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <FieldLabel className="text-sm font-medium">
                ラベル名（日本語名） <span className="text-destructive">*</span>
              </FieldLabel>
              <Input ref={newNameRef} value={newName} onChange={(e) => setNewName(e.target.value)}
                placeholder="例：不具合事例" className="h-8" autoFocus />
            </div>
            <div className="space-y-1.5">
              <FieldLabel className="text-sm font-medium">ラベル名（英語名）</FieldLabel>
              <Input value={newNameEn} onChange={(e) => setNewNameEn(e.target.value)}
                placeholder="例：Defect Case" className="h-8" />
            </div>
            <div className="space-y-1.5">
              <FieldLabel className="text-sm font-medium">ラベル同義語</FieldLabel>
              <SynonymInput value={newSynonyms} onChange={setNewSynonyms} ownName={newName} />
            </div>
            <div className="space-y-1.5">
              <FieldLabel className="text-sm font-medium">ラベルグループ</FieldLabel>
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
              <FieldLabel className="text-sm font-medium">説明</FieldLabel>
              <Textarea rows={3} value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
            </div>
            {addError && <p className="text-xs text-destructive">{addError}</p>}
            {addedNames.length > 0 && (
              <p className="text-xs text-muted-foreground">
                追加済み：{addedNames.join("、")}
              </p>
            )}
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
          <DialogHeader><DialogTitle>ラベルを削除</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            <p>「{selected?.name}」を削除します。</p>
            {(nodeCounts[selected?.id ?? ""] ?? 0) > 0 && (
              <p className="text-muted-foreground">
                このラベルが付いている {nodeCounts[selected?.id ?? ""]}件のノードから、ラベルだけを外します
                （ノード自体は消えません）。このラベルを端点に持つリレーションシップタイプのラベルペアも外れます。
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)}>キャンセル</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}削除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* まとめて削除 */}
      <Dialog open={showBulkDelete} onOpenChange={setShowBulkDelete}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>ラベルをまとめて削除</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            <p>{deletableTargets.length}件のラベルを削除します。この操作は取り消せません。</p>
            <p className="max-h-32 overflow-y-auto text-xs text-muted-foreground">
              {deletableTargets.map((l) => l.name).join("、")}
            </p>
            {targets.length > deletableTargets.length && (
              <p className="text-xs text-amber-600 dark:text-amber-500">
                予約ラベルは削除できないため、対象から外しています。
              </p>
            )}
            {bulkDeleteNodeCount > 0 && (
              <p className="text-muted-foreground">
                のべ {bulkDeleteNodeCount}件のノードからラベルだけを外します（ノード自体は消えません）。
                これらのラベルを端点に持つリレーションシップタイプのラベルペアも外れます。
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkDelete(false)} disabled={bulkDeleting}>
              キャンセル
            </Button>
            <Button variant="destructive" onClick={handleBulkDelete} disabled={bulkDeleting}>
              {bulkDeleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}削除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={showConfirm}
        onOpenChange={setShowConfirm}
        title="ラベルを確認"
        description={`${checkedIds.size}件のラベルに確認レコードを追加します。`}
        submitting={confirming}
        onSubmit={handleConfirm}
      />

      {currentProject && (
        <GroupManagerDialog
          open={showGroupManager}
          onOpenChange={setShowGroupManager}
          projectId={currentProject.id}
          target="class"
          groups={groups}
          onSaved={setGroups}
        />
      )}
    </div>
  )
}
