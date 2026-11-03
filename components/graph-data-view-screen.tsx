"use client"

// グラフデータ確認（グラフデータ作成）。リレーションシップタイプを1つ選び、そのタイプで作った
// リレーションシップだけを図で見る。スキーマ確認のデータ版。
//
// 【全体図にしない理由】スキーマ確認と同じ。ノードとリレーションシップを全部1枚に描くと線が重なって
// 何も読めなくなる。登録中に知りたいのは「このタイプで、どの始点からどの終点へ繋いだか（抜け・誤りは無いか）」
// なので、1タイプに絞り、始点ノードごとに終点ノードを並べて引き出し線で結ぶ。
// 1つの始点から終点だけ変えて続けて登録していく使い方と、同じ形になる。
//
// 定義したがまだ使っていないラベル・タイプ（エクスポートには影響しない参考情報）もここで見せる。

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, Info, Loader2, Search } from "lucide-react"
import { TopBar } from "@/components/top-bar"
import { Input } from "@/components/ui/input"
import { LabelChip, LabelChips } from "@/components/label-chip"
import { CheckCard, toggleKey } from "@/components/check-card"
import { cn } from "@/lib/utils"
import { normalizeName } from "@/lib/normalize"
import { deriveConfirmationStatus } from "@/lib/confirmation"
import { relTypeAllows } from "@/lib/graph-types"
import { runChecks, type GraphData } from "@/lib/graph-cypher"
import { useProject } from "@/app/project-context"
import { useListOrder } from "@/components/use-list-order"
import type { Relationship } from "@/lib/graph-types"

const EMPTY: GraphData = { labels: [], relTypes: [], nodes: [], relationships: [], propertyDefs: [] }

// 左の一覧で、タイプではなく「使われていない定義」を選んだとき
const UNUSED = "__unused__"

// 始点ノード1つ分（同じ始点のリレーションシップをまとめて1行にする）
type Row = { startId: string; startName: string; startLabelIds: string[]; rels: Relationship[] }

export function GraphDataViewScreen({ active }: { active?: boolean }) {
  const { currentProject, loading: projectLoading } = useProject()
  const projectId = currentProject?.id

  const [data, setData] = useState<GraphData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [typeQuery, setTypeQuery] = useState("")
  const [nodeQuery, setNodeQuery] = useState("")
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set())

  const fetchAll = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const [labels, relTypes, nodes, relationships, propertyDefs] = await Promise.all([
        fetch(`/api/labels?projectId=${projectId}`).then((r) => r.json()),
        fetch(`/api/relationship-types?projectId=${projectId}`).then((r) => r.json()),
        fetch(`/api/nodes?projectId=${projectId}`).then((r) => r.json()),
        fetch(`/api/relationships?projectId=${projectId}`).then((r) => r.json()),
        fetch(`/api/properties?projectId=${projectId}`).then((r) => r.json()),
      ])
      setData({
        labels: Array.isArray(labels) ? labels : [],
        relTypes: Array.isArray(relTypes) ? relTypes : [],
        nodes: Array.isArray(nodes) ? nodes : [],
        relationships: Array.isArray(relationships) ? relationships : [],
        propertyDefs: Array.isArray(propertyDefs) ? propertyDefs : [],
      })
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (projectLoading) return
    setData(EMPTY); setSelectedId(null)
    setLoading(!!projectId)
  }, [projectId, projectLoading])

  useEffect(() => {
    if (active && projectId) fetchAll()
  }, [active, projectId, fetchAll])

  const { labels, relTypes, nodes, relationships } = data
  const labelById = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels])
  const labelName = useCallback((id: string) => labelById.get(id)?.name ?? "（削除済み）", [labelById])
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const typeById = useMemo(() => new Map(relTypes.map((t) => [t.id, t])), [relTypes])

  // 端のノードが残っていれば今のラベルで、消えていれば作成時のスナップショットで見る（リレーションシップ管理と同じ）
  const labelsOf = useCallback(
    (nodeId: string, snapshot: string[] | undefined) => nodeById.get(nodeId)?.labelIds ?? snapshot ?? [],
    [nodeById],
  )
  const matchesSchema = useCallback((r: Relationship): boolean => {
    const type = typeById.get(r.relTypeId)
    if (!type) return false
    return relTypeAllows(type, labelsOf(r.startNodeId, r.startNodeLabelIds), labelsOf(r.endNodeId, r.endNodeLabelIds))
  }, [typeById, labelsOf])

  // タイプごとのリレーションシップ数（左の一覧に出す）
  const countByType = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of relationships) m.set(r.relTypeId, (m.get(r.relTypeId) ?? 0) + 1)
    return m
  }, [relationships])

  const unusedChecks = useMemo(() => runChecks(data).filter((c) => c.category === "schema"), [data])
  const unusedCount = unusedChecks.reduce((n, c) => n + c.items.length, 0)

  // 左の一覧はリレーションシップタイプ管理と同じ並び（タイプグループの順、その中は手で並べた順）にする
  const { ordered: orderedTypes, grouped: typeGroups } = useListOrder(relTypes, projectId, "relation", active)
  const listedGroups = useMemo(() => {
    const q = normalizeName(typeQuery)
    return typeGroups
      .map((g) => ({ ...g, items: g.items.filter((t) => !q || normalizeName(t.name).includes(q)) }))
      .filter((g) => g.items.length > 0)
  }, [typeGroups, typeQuery])

  // 最初に開いたときは、並びの先頭からリレーションシップのあるタイプを選ぶ
  useEffect(() => {
    if (selectedId === UNUSED || (selectedId && typeById.has(selectedId))) return
    const first = orderedTypes.find((t) => (countByType.get(t.id) ?? 0) > 0) ?? orderedTypes[0]
    if (first) setSelectedId(first.id)
  }, [orderedTypes, countByType, selectedId, typeById])

  const selectedType = selectedId && selectedId !== UNUSED ? typeById.get(selectedId) ?? null : null

  // 選んだタイプのリレーションシップを始点ノードごとにまとめる。始点・終点とも名前順。
  // ノード名で絞り込むときは、始点か終点のどちらかが当たるものを残す。
  const typeRels = useMemo(
    () => (selectedType ? relationships.filter((r) => r.relTypeId === selectedType.id) : []),
    [relationships, selectedType],
  )
  const rows = useMemo<Row[]>(() => {
    const q = normalizeName(nodeQuery)
    const m = new Map<string, Row>()
    for (const r of typeRels) {
      if (q && !normalizeName(r.startNodeName).includes(q) && !normalizeName(r.endNodeName).includes(q)) continue
      const row = m.get(r.startNodeId) ?? {
        startId: r.startNodeId,
        startName: nodeById.get(r.startNodeId)?.name ?? r.startNodeName,
        startLabelIds: labelsOf(r.startNodeId, r.startNodeLabelIds),
        rels: [],
      }
      row.rels.push(r)
      m.set(r.startNodeId, row)
    }
    const endName = (r: Relationship) => nodeById.get(r.endNodeId)?.name ?? r.endNodeName
    return [...m.values()]
      .map((row) => ({ ...row, rels: [...row.rels].sort((a, b) => endName(a).localeCompare(endName(b), "ja")) }))
      .sort((a, b) => a.startName.localeCompare(b.startName, "ja"))
  }, [typeRels, nodeQuery, nodeById, labelsOf])

  const mismatchCount = useMemo(() => typeRels.filter((r) => !matchesSchema(r)).length, [typeRels, matchesSchema])
  const endCount = useMemo(() => new Set(typeRels.map((r) => r.endNodeId)).size, [typeRels])
  const startCount = useMemo(() => new Set(typeRels.map((r) => r.startNodeId)).size, [typeRels])

  // 引き出し線。始点ノードと各終点ノードの位置を測り、その間を曲線で結ぶ（スキーマ確認と同じ描き方）。
  const boardRef = useRef<HTMLDivElement>(null)
  const anchorRefs = useRef(new Map<string, HTMLElement>())
  const [paths, setPaths] = useState<{ key: string; d: string; dashed: boolean; warn: boolean }[]>([])
  const [boardSize, setBoardSize] = useState({ w: 0, h: 0 })

  const measure = useCallback(() => {
    const board = boardRef.current
    if (!board) { setPaths([]); return }
    const b = board.getBoundingClientRect()
    const rel = (el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      return { left: r.left - b.left, right: r.right - b.left, y: r.top + r.height / 2 - b.top }
    }
    const next: { key: string; d: string; dashed: boolean; warn: boolean }[] = []
    for (const row of rows) {
      const startEl = anchorRefs.current.get(`start:${row.startId}`)
      if (!startEl) continue
      const s = rel(startEl)
      for (const r of row.rels) {
        const endEl = anchorRefs.current.get(`end:${r.id}`)
        if (!endEl) continue
        const e = rel(endEl)
        const x2 = e.left - 1
        const mx = (s.right + x2) / 2
        next.push({
          key: r.id,
          d: `M ${s.right} ${s.y} C ${mx} ${s.y}, ${mx} ${e.y}, ${x2} ${e.y}`,
          // 未確認のものは点線、スキーマに無い組み合わせは黄色
          dashed: deriveConfirmationStatus(r.confirmations).state === "unconfirmed",
          warn: !matchesSchema(r),
        })
      }
    }
    setPaths(next)
    setBoardSize({ w: b.width, h: b.height })
  }, [rows, matchesSchema])

  useLayoutEffect(() => { measure() }, [measure, active])

  useEffect(() => {
    const board = boardRef.current
    if (!board) return
    const ro = new ResizeObserver(() => measure())
    ro.observe(board)
    return () => ro.disconnect()
  }, [measure, selectedId, loading])

  const setAnchor = (key: string) => (el: HTMLElement | null) => {
    if (el) anchorRefs.current.set(key, el)
    else anchorRefs.current.delete(key)
  }

  // ノード1つ分の箱（上段にラベル、下段にノード名）
  const NodeBox = ({ name, labelIds, warn }: { name: string; labelIds: string[]; warn?: boolean }) => (
    <span className={cn(
      "relative z-10 block max-w-64 space-y-1 rounded-md border bg-background px-2 py-1",
      warn ? "border-amber-400 dark:border-amber-600" : "border-border",
    )}>
      <LabelChips names={labelIds.map(labelName)} />
      <span className="flex items-center gap-1 text-sm text-foreground">
        {warn && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-500" />}
        <span className="truncate" title={name}>{name}</span>
      </span>
    </span>
  )

  return (
    <div className="flex h-full flex-col">
      <TopBar group="グラフデータ作成" title="グラフデータ確認">
        {!loading && currentProject && (
          <span className="text-xs text-muted-foreground">
            タイプ {relTypes.length}・リレーションシップ {relationships.length}
          </span>
        )}
      </TopBar>

      <div className="flex flex-1 overflow-hidden">
        {/* 左：見るタイプを選ぶ */}
        <div className="flex w-64 shrink-0 flex-col overflow-hidden border-r border-border">
          <div className="space-y-2 px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">リレーションシップタイプ</h2>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={typeQuery} onChange={(e) => setTypeQuery(e.target.value)}
                placeholder="タイプ名で検索" className="h-8 pl-7" />
            </div>
          </div>
          <div className="flex items-center justify-between px-4.5 pb-1 text-xs text-muted-foreground">
            <span>タイプ名</span>
            <span>件数</span>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-4">
            {listedGroups.map((g) => (
              <div key={g.key} className="mb-2">
                <div className="flex items-center gap-1.5 px-2.5 pb-1 pt-2 text-xs">
                  <span className="h-2 w-2 shrink-0 rounded-full border border-border"
                    style={g.color ? { backgroundColor: g.color } : undefined} />
                  <span className="text-muted-foreground">タイプグループ：</span>
                  <span className="truncate font-semibold text-foreground">{g.name}</span>
                </div>
                {g.items.map((t) => {
                  const n = countByType.get(t.id) ?? 0
                  return (
                    <button key={t.id} type="button"
                      className={cn(
                        "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                        selectedId === t.id
                          ? "bg-indigo-100 text-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-100"
                          : "hover:bg-muted",
                        n === 0 && selectedId !== t.id && "text-muted-foreground",
                      )}
                      onClick={() => { setSelectedId(t.id); setNodeQuery("") }}>
                      <span className="truncate">{t.name}</span>
                      <span className="ml-2 shrink-0 text-xs text-muted-foreground">{n}</span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
          <div className="border-t border-border p-2">
            <button type="button"
              className={cn(
                "flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                selectedId === UNUSED
                  ? "bg-indigo-100 text-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-100"
                  : "text-muted-foreground hover:bg-muted",
              )}
              onClick={() => setSelectedId(UNUSED)}>
              <Info className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1 truncate">使われていない定義</span>
              <span className="ml-2 shrink-0 text-xs text-muted-foreground">{unusedCount}</span>
            </button>
          </div>
        </div>

        {/* 右：選んだタイプのリレーションシップ */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {loading && relTypes.length === 0 ? (
            <div className="m-auto flex h-32 items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : !currentProject ? (
            <p className="m-auto p-4 text-center text-sm text-muted-foreground">プロジェクトを選択してください</p>
          ) : selectedId === UNUSED ? (
            <div className="flex-1 overflow-auto px-6 py-4">
              <section className="space-y-3">
                <div className="space-y-1">
                  <h2 className="text-base font-semibold text-foreground">使われていない定義</h2>
                  <p className="text-xs text-muted-foreground">
                    定義したもののまだ使っていないラベル・リレーションシップタイプです。
                    出力には現れないので、エクスポートには影響しません。
                  </p>
                </div>
                <div className="space-y-2">
                  {unusedChecks.map((c) => (
                    <CheckCard key={c.key} check={c} info open={openKeys.has(c.key)}
                      onToggle={() => setOpenKeys((prev) => toggleKey(prev, c.key))} />
                  ))}
                </div>
              </section>
            </div>
          ) : !selectedType ? (
            <p className="m-auto p-4 text-center text-sm text-muted-foreground">左からリレーションシップタイプを選んでください</p>
          ) : (
            <>
              {/* 見出し：タイプの名前・ラベルペア・件数 */}
              <div className="space-y-2 border-b border-border px-6 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h2 className="text-base font-semibold text-foreground">{selectedType.name}</h2>
                    <span className="text-xs text-muted-foreground">
                      {typeRels.length}件（始点 {startCount}・終点 {endCount}）
                    </span>
                    {mismatchCount > 0 && (
                      <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        スキーマに無い組み合わせ {mismatchCount}件
                      </span>
                    )}
                  </div>
                  {typeRels.length > 0 && (
                    <div className="relative w-56">
                      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input value={nodeQuery} onChange={(e) => setNodeQuery(e.target.value)}
                        placeholder="ノード名で絞り込む" className="h-8 pl-7" />
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {(selectedType.labelPairs ?? []).length > 0 && (
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      ラベルペア：
                      {(selectedType.labelPairs ?? []).map((p, i) => (
                        <span key={i} className="inline-flex items-center gap-1">
                          <LabelChip name={labelName(p.sourceLabelId)} />→<LabelChip name={labelName(p.targetLabelId)} />
                        </span>
                      ))}
                    </span>
                  )}
                  {typeRels.length > 0 && (
                    <span className="flex items-center gap-3">
                      <span className="flex items-center gap-1">
                        <svg width="20" height="6" aria-hidden className="text-muted-foreground">
                          <line x1="0" y1="3" x2="20" y2="3" stroke="currentColor" strokeWidth="1.5" />
                        </svg>確認済み
                      </span>
                      <span className="flex items-center gap-1">
                        <svg width="20" height="6" aria-hidden className="text-muted-foreground">
                          <line x1="0" y1="3" x2="20" y2="3" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" />
                        </svg>未確認
                      </span>
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-1 overflow-auto px-8 py-6">
                {typeRels.length === 0 ? (
                  <p className="m-auto p-4 text-center text-sm text-muted-foreground">
                    このタイプのリレーションシップはまだありません。
                  </p>
                ) : rows.length === 0 ? (
                  <p className="m-auto p-4 text-center text-sm text-muted-foreground">該当するノードがありません</p>
                ) : (
                  <div ref={boardRef} className="relative mx-auto grid h-fit grid-cols-[auto_auto] items-center gap-x-24 gap-y-6">
                    {/* 引き出し線 */}
                    <svg className="pointer-events-none absolute inset-0 overflow-visible"
                      width={boardSize.w} height={boardSize.h} aria-hidden>
                      <defs>
                        {/* 矢印は線と同じ色にする（黄色の線には黄色の矢印） */}
                        {(["data-arrow", "data-arrow-warn"] as const).map((id) => (
                          <marker key={id} id={id} viewBox="0 0 10 10" refX="9" refY="5"
                            markerWidth="7" markerHeight="7" orient="auto-start-reverse"
                            className={id === "data-arrow" ? "text-muted-foreground/60" : "text-amber-500"}>
                            <path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="currentColor" strokeWidth="1.5" />
                          </marker>
                        ))}
                      </defs>
                      {paths.map((p) => (
                        <path key={p.key} d={p.d} fill="none" stroke="currentColor" strokeWidth="1.25"
                          className={p.warn ? "text-amber-500" : "text-muted-foreground/60"}
                          strokeDasharray={p.dashed ? "4 3" : undefined}
                          markerEnd={p.warn ? "url(#data-arrow-warn)" : "url(#data-arrow)"} />
                      ))}
                    </svg>

                    {rows.map((row) => (
                      <div key={row.startId} className="contents">
                        {/* 始点ノード */}
                        <div className="flex justify-end">
                          <span ref={setAnchor(`start:${row.startId}`)}>
                            <NodeBox name={row.startName} labelIds={row.startLabelIds} />
                          </span>
                        </div>
                        {/* 終点ノード */}
                        <div className="flex flex-col items-start gap-1.5">
                          {row.rels.map((r) => (
                            <span key={r.id} ref={setAnchor(`end:${r.id}`)}>
                              <NodeBox name={nodeById.get(r.endNodeId)?.name ?? r.endNodeName}
                                labelIds={labelsOf(r.endNodeId, r.endNodeLabelIds)} warn={!matchesSchema(r)} />
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
