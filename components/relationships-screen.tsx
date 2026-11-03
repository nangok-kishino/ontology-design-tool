"use client"

// リレーションシップ管理（グラフデータ作成）。旧トリプレット管理の後継。
//
// 端がクラスのトリプレット（旧 ClassTriplet）という特別扱いは無くなった。
// カテゴリそのものもノードとして持つので、すべてここに一本化される（docs/graph-model.md §4）。
//
// ラベルペアに合わない組み合わせは【拒否せず警告】にしてある。ラベルの階層が無くなったため、
// 上位ラベルの付け忘れで「本当は正しいのに弾かれる」ことが起こりうるため。

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { TopBar } from "@/components/top-bar"
import { Tooltip } from "@/components/ui/tooltip"
import { ConfirmationBadge } from "@/components/confirmation-badge"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { DragRow, ListDndContext } from "@/components/list-dnd"
import { LabelChips } from "@/components/label-chip"
import { RelationshipAddDialog } from "@/components/relationship-add-dialog"
import { RelationshipDetailPanel } from "@/components/relationship-detail-panel"
import { cn } from "@/lib/utils"
import { ORDER_STEP, orderBetween, placeAt, sortByOrder } from "@/lib/organize"
import { normalizeName } from "@/lib/normalize"
import { deriveConfirmationStatus, type ConfirmationState } from "@/lib/confirmation"
import { conditionSetsOf, relTypeAllows } from "@/lib/graph-types"
import type { GraphNode, Label, PropertyDef, Relationship, RelationshipType } from "@/lib/graph-types"
import {
  AlertTriangle, CheckCircle2, Loader2, Plus, Search, Trash2, X,
} from "lucide-react"
import { useProject } from "@/app/project-context"
import { useListOrder } from "@/components/use-list-order"

const ALL = "__all__"

function toggleIn(set: Set<string>, id: string): Set<string> {
  const next = new Set(set)
  next.has(id) ? next.delete(id) : next.add(id)
  return next
}

export function RelationshipsScreen({ active }: { active?: boolean }) {
  const { currentProject, loading: projectLoading } = useProject()
  const projectId = currentProject?.id

  const [relationships, setRelationships] = useState<Relationship[]>([])
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [relTypes, setRelTypes] = useState<RelationshipType[]>([])
  const [labels, setLabels] = useState<Label[]>([])
  const [propertyDefs, setPropertyDefs] = useState<PropertyDef[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [typeFilter, setTypeFilter] = useState<string>(ALL)
  const [query, setQuery] = useState("")
  const [filterState, setFilterState] = useState<"all" | ConfirmationState>("all")
  const [onlyMismatch, setOnlyMismatch] = useState(false)
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [showConfirm, setShowConfirm] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [unconfirming, setUnconfirming] = useState(false)

  // 追加
  const [showAdd, setShowAdd] = useState(false)

  const [showBulkDelete, setShowBulkDelete] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const selected = useMemo(
    () => relationships.find((r) => r.id === selectedId) ?? null,
    [relationships, selectedId],
  )
  const labelById = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels])
  const labelName = useCallback((id: string) => labelById.get(id)?.name ?? "（削除済み）", [labelById])
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const typeById = useMemo(() => new Map(relTypes.map((t) => [t.id, t])), [relTypes])

  // ─── 取得 ───
  const fetchAll = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const [rels, nodeList, types, labelList, props] = await Promise.all([
        fetch(`/api/relationships?projectId=${projectId}`).then((r) => r.json()),
        fetch(`/api/nodes?projectId=${projectId}`).then((r) => r.json()),
        fetch(`/api/relationship-types?projectId=${projectId}`).then((r) => r.json()),
        fetch(`/api/labels?projectId=${projectId}`).then((r) => r.json()),
        fetch(`/api/properties?projectId=${projectId}`).then((r) => r.json()),
      ])
      setRelationships(Array.isArray(rels) ? rels : [])
      setNodes(Array.isArray(nodeList) ? nodeList : [])
      setRelTypes(Array.isArray(types) ? types : [])
      setLabels(Array.isArray(labelList) ? labelList : [])
      setPropertyDefs(Array.isArray(props) ? props : [])
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (projectLoading) return
    setRelationships([]); setNodes([]); setRelTypes([]); setLabels([]); setPropertyDefs([])
    setSelectedId(null); setCheckedIds(new Set()); setTypeFilter(ALL)
    setLoading(!!projectId)
  }, [projectId, projectLoading])

  useEffect(() => {
    if (active && projectId) fetchAll()
  }, [active, projectId, fetchAll])

  // ─── スキーマ整合（ラベルペアに合っているか） ───
  // 端のノードが残っていれば今のラベルで、消えていれば作成時のスナップショットで見る。
  const labelsOf = useCallback(
    (nodeId: string, snapshot: string[] | undefined) => nodeById.get(nodeId)?.labelIds ?? snapshot ?? [],
    [nodeById],
  )
  const matchesSchema = useCallback((r: Relationship): boolean => {
    const type = typeById.get(r.relTypeId)
    if (!type) return false
    return relTypeAllows(
      type,
      labelsOf(r.startNodeId, r.startNodeLabelIds),
      labelsOf(r.endNodeId, r.endNodeLabelIds),
    )
  }, [typeById, labelsOf])

  const mismatchCount = useMemo(
    () => relationships.filter((r) => !matchesSchema(r)).length,
    [relationships, matchesSchema],
  )

  // ─── 一覧 ───
  const rows = useMemo(() => {
    const q = normalizeName(query)
    return sortByOrder(
      relationships
        .filter((r) => typeFilter === ALL || r.relTypeId === typeFilter)
        .filter((r) => filterState === "all" || deriveConfirmationStatus(r.confirmations).state === filterState)
        .filter((r) => !onlyMismatch || !matchesSchema(r))
        .filter((r) =>
          !q ||
          normalizeName(r.startNodeName).includes(q) ||
          normalizeName(r.endNodeName).includes(q) ||
          normalizeName(r.relTypeName).includes(q),
        ),
    )
  }, [relationships, typeFilter, filterState, onlyMismatch, query, matchesSchema])

  const canReorder = filterState === "all" && !query && !onlyMismatch && typeFilter === ALL

  // ─── 並べ替え ───
  const applyReorder = useCallback(async (updates: { id: string; order: number }[]) => {
    if (!projectId || updates.length === 0) return
    setRelationships((prev) =>
      prev.map((r) => {
        const u = updates.find((x) => x.id === r.id)
        return u ? { ...r, order: u.order } : r
      }),
    )
    try {
      const res = await fetch("/api/relationships/reorder", {
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
    const moved = relationships.find((r) => r.id === activeId)
    if (!moved) return
    // 動かす行も含めた並びを渡す。下へ動かしたときに落とした行の位置へ入り、1つ手前に戻らないようにするため
    const { ordered, index } = placeAt(rows, moved, overId)
    const unnumbered = ordered.some((r) => r.order === undefined)
    const between = unnumbered ? null : orderBetween(ordered[index - 1], ordered[index + 1])
    applyReorder(
      between === null
        ? ordered.map((r, i) => ({ id: r.id, order: (i + 1) * ORDER_STEP }))
        : [{ id: ordered[index].id, order: between }],
    )
  }

  // タイプはリレーションシップタイプ管理と同じ並び（タイプグループの順、その中は手で並べた順）
  const { ordered: orderedTypes } = useListOrder(relTypes, projectId, "relation", active)

  // ─── 追加 ───
  const handleCreated = (created: Relationship, keepOpen: boolean) => {
    setRelationships((prev) => [...prev, created])
    if (!keepOpen) setSelectedId(created.id)
  }

  // ─── 確認（承認） ───
  const targets = useMemo(() => relationships.filter((r) => checkedIds.has(r.id)), [relationships, checkedIds])
  const canBulkConfirm = targets.some((r) => deriveConfirmationStatus(r.confirmations).state !== "confirmed")
  const canBulkUnconfirm = targets.some((r) => deriveConfirmationStatus(r.confirmations).state !== "unconfirmed")

  const applyConfirmations = (updated: (Relationship | null)[]) => {
    const ok = updated.filter((r): r is Relationship => r !== null)
    const byId = new Map(ok.map((r) => [r.id, r]))
    setRelationships((prev) => prev.map((r) => byId.get(r.id) ?? r))
    setCheckedIds(new Set())
  }

  // ─── まとめて削除 ───
  const handleBulkDelete = async () => {
    setBulkDeleting(true)
    try {
      const results = await Promise.all(
        targets.map((r) =>
          fetch(`/api/relationships/${r.id}`, { method: "DELETE" }).then((res) => (res.ok ? r.id : null)),
        ),
      )
      const removed = new Set(results.filter((id): id is string => id !== null))
      setRelationships((prev) => prev.filter((r) => !removed.has(r.id)))
      if (selectedId && removed.has(selectedId)) setSelectedId(null)
      setCheckedIds(new Set())
      setShowBulkDelete(false)
    } finally {
      setBulkDeleting(false)
    }
  }

  const handleConfirm = async (confirmerName: string) => {
    setConfirming(true)
    try {
      const updated = await Promise.all(
        targets.map((r) =>
          fetch(`/api/relationships/${r.id}/confirmations`, {
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
          fetch(`/api/relationships/${r.id}/confirmations`, { method: "DELETE" })
            .then((res) => (res.ok ? res.json() : null)),
        ),
      )
      applyConfirmations(updated)
    } finally {
      setUnconfirming(false)
    }
  }

  const nodeLabelNames = (nodeId: string, snapshot: string[] | undefined) =>
    labelsOf(nodeId, snapshot).map(labelName)

  return (
    <div className="flex h-full flex-col">
      <TopBar group="グラフデータ作成" title="リレーションシップ管理">
        {!loading && currentProject && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {mismatchCount > 0 && (
              <span className="flex items-center gap-1 text-amber-600 dark:text-amber-500">
                <AlertTriangle className="h-3.5 w-3.5" />
                スキーマに無い組み合わせ {mismatchCount}件
              </span>
            )}
            <span>リレーションシップ {relationships.length}</span>
          </div>
        )}
      </TopBar>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden border-r border-border">
          <div className="flex items-center justify-between gap-3 px-6 py-3">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <h2 className="shrink-0 text-base font-semibold text-foreground">リレーションシップ一覧</h2>
              <div className="relative w-56">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder="ノード名・タイプ名で検索" className="h-8 pl-7" />
              </div>
              <Select value={typeFilter} onValueChange={(v) => { if (v) setTypeFilter(v) }}>
                <SelectTrigger className="h-8 w-56">
                  <SelectValue>
                    {typeFilter === ALL ? "すべてのタイプ" : typeById.get(typeFilter)?.name ?? "すべてのタイプ"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={ALL}>すべてのタイプ</SelectItem>
                  {orderedTypes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1.5 bg-transparent"
              onClick={() => setShowAdd(true)} disabled={!currentProject}>
              <Plus className="h-3.5 w-3.5" />リレーションシップを追加
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2 px-6 pb-3 text-xs">
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
            <button type="button"
              className={cn(
                "shrink-0 whitespace-nowrap rounded-full border px-2.5 py-0.5 transition-colors",
                onlyMismatch
                  ? "border-amber-400 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-200"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
              onClick={() => setOnlyMismatch((v) => !v)}>
              スキーマに無い組み合わせ{mismatchCount > 0 ? `（${mismatchCount}）` : ""}
            </button>
            {!canReorder && (
              <span className="text-muted-foreground">（絞り込み中は並べ替えできません）</span>
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
                onClick={() => setShowBulkDelete(true)}>
                <Trash2 className="h-3.5 w-3.5" />削除する
              </Button>
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col px-6 pb-6">
            {loading && relationships.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : rows.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">
                {!currentProject ? "プロジェクトを選択してください"
                  : relationships.length === 0 ? "リレーションシップが登録されていません"
                    : "条件に合うリレーションシップがありません"}
              </p>
            ) : (
              <ListDndContext
                onDrop={handleRowDrop}
                labelOf={(id) => {
                  const r = relationships.find((x) => x.id === id)
                  return <span className="font-medium text-foreground">{r ? `${r.startNodeName} → ${r.endNodeName}` : id}</span>
                }}
              >
                <div className="h-full overflow-hidden rounded-lg border border-border">
                  <Table containerClassName="h-full overflow-auto">
                    <TableHeader>
                      {/* 縦スクロールしても見出しは残す */}
                      <TableRow className="bg-muted hover:bg-muted [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:bg-muted">
                        <TableHead className="w-8" />
                        <TableHead className="w-10">
                          <input type="checkbox" aria-label="表示中のリレーションシップをすべて選択"
                            checked={rows.length > 0 && rows.every((r) => checkedIds.has(r.id))}
                            onChange={(e) => {
                              const next = new Set(checkedIds)
                              if (e.target.checked) rows.forEach((r) => next.add(r.id))
                              else rows.forEach((r) => next.delete(r.id))
                              setCheckedIds(next)
                            }} />
                        </TableHead>
                        <TableHead className="font-semibold text-foreground">始点ノード(A)</TableHead>
                        <TableHead className="font-semibold text-foreground">リレーションシップタイプ</TableHead>
                        <TableHead className="font-semibold text-foreground">終点ノード(B)</TableHead>
                        <TableHead className="w-20 font-semibold text-foreground">条件有無</TableHead>
                        <TableHead className="w-32 font-semibold text-foreground">登録確認</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => {
                        const status = deriveConfirmationStatus(r.confirmations)
                        const ok = matchesSchema(r)
                        return (
                          <DragRow key={r.id} id={r.id} label={r.startNodeName} enabled={canReorder}
                            className={cn(
                              "cursor-pointer transition-colors",
                              selectedId === r.id
                                ? "bg-indigo-100 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-950/50"
                                : "hover:bg-muted/50",
                            )}
                            onClick={() => setSelectedId(r.id)}>
                            <TableCell className="align-top" onClick={(e) => e.stopPropagation()}>
                              <input type="checkbox" aria-label={`${r.startNodeName}のリレーションシップを選択`}
                                checked={checkedIds.has(r.id)}
                                onChange={() => setCheckedIds((prev) => toggleIn(prev, r.id))} />
                            </TableCell>
                            <TableCell className="align-top">
                              {/* 上段にラベル、下段にノード名 */}
                              <LabelChips names={nodeLabelNames(r.startNodeId, r.startNodeLabelIds)} />
                              <span className="mt-1 block font-medium text-foreground">{r.startNodeName}</span>
                            </TableCell>
                            <TableCell className="align-top text-sm">
                              <span className="flex items-center gap-1 text-foreground">
                                {!ok && (
                                  <Tooltip content="このラベルの組み合わせは、タイプのラベルペアに定義されていません">
                                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
                                  </Tooltip>
                                )}
                                {r.relTypeName}
                              </span>
                            </TableCell>
                            <TableCell className="align-top">
                              <LabelChips names={nodeLabelNames(r.endNodeId, r.endNodeLabelIds)} />
                              <span className="mt-1 block font-medium text-foreground">{r.endNodeName}</span>
                            </TableCell>
                            <TableCell className="align-top text-sm text-foreground">
                              {(() => {
                                // セットが複数あるときは、いくつあるかも出す
                                const n = conditionSetsOf(r).length
                                return n === 0 ? null : n === 1 ? "あり" : `あり（${n}セット）`
                              })()}
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

        {/* 詳細（リレーションシップ1件の編集はグラフデータ確認と共用のパネル） */}
        {selected && (
          <RelationshipDetailPanel relationship={selected} relationships={relationships}
            nodes={nodes} relTypes={relTypes} propertyDefs={propertyDefs} labelName={labelName}
            onUpdated={(updated) => setRelationships((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))}
            onDeleted={(id) => {
              setRelationships((prev) => prev.filter((r) => r.id !== id))
              setSelectedId(null)
            }} />
        )}
      </div>

      {/* 追加 */}
      <RelationshipAddDialog open={showAdd} onOpenChange={setShowAdd}
        projectId={projectId} relationships={relationships} nodes={nodes}
        orderedTypes={orderedTypes} labelName={labelName}
        initialTypeId={typeFilter !== ALL ? typeFilter : undefined}
        onCreated={handleCreated} />

      {/* まとめて削除 */}
      <Dialog open={showBulkDelete} onOpenChange={setShowBulkDelete}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>リレーションシップをまとめて削除</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            <p>{targets.length}件のリレーションシップを削除します。この操作は取り消せません。</p>
            <p className="max-h-32 overflow-y-auto text-xs text-muted-foreground">
              {targets.map((r) => `${r.startNodeName} → ${r.relTypeName} → ${r.endNodeName}`).join("／")}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkDelete(false)} disabled={bulkDeleting}>
              キャンセル
            </Button>
            <Button variant="destructive" onClick={handleBulkDelete} disabled={bulkDeleting || targets.length === 0}>
              {bulkDeleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}削除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={showConfirm} onOpenChange={setShowConfirm}
        title="リレーションシップを確認"
        description={`${checkedIds.size}件のリレーションシップに確認レコードを追加します。`}
        submitting={confirming} onSubmit={handleConfirm} />
    </div>
  )
}
