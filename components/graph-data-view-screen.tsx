"use client"

// グラフデータ確認（グラフデータ作成）。リレーションシップタイプを1つ選び、そのタイプで作った
// リレーションシップだけを図で見る。スキーマ確認のデータ版。
//
// 【全体図にしない理由】スキーマ確認と同じ。ノードとリレーションシップを全部1枚に描くと線が重なって
// 何も読めなくなる。登録中に知りたいのは「このタイプで、どの始点からどの終点へ繋いだか（抜け・誤りは無いか）」
// なので、1タイプに絞り、始点ノード → タイプ → 終点ノードの順に並べて引き出し線で結ぶ。
//
// 【束ね方】始点・終点が共通なものは、1つのタイプにまとめて描く（4つの始点 → タイプ → 1つの終点、など）。
// ただし束ねてよいのは「束の中の始点と終点が、すべての組み合わせで繋がっている」ときだけにする。
// 一部しか繋がっていないものを束ねると、どの始点がどの終点に繋がるのかが図から読めなくなるため。
// さらに確認状態・スキーマ整合が同じものだけを束ね、線の見た目（点線・黄色）が1本1本の実際と食い違わないようにする。
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
import { sortByOrder } from "@/lib/organize"
import { deriveConfirmationStatus } from "@/lib/confirmation"
import { relTypeAllows } from "@/lib/graph-types"
import { runChecks, type GraphData } from "@/lib/graph-cypher"
import { useProject } from "@/app/project-context"
import { useListOrder } from "@/components/use-list-order"
import type { Relationship } from "@/lib/graph-types"

const EMPTY: GraphData = { labels: [], relTypes: [], nodes: [], relationships: [], propertyDefs: [] }

// 左の一覧で、タイプではなく「使われていない定義」を選んだとき
const UNUSED = "__unused__"

// 束1つ分。starts × ends のすべての組み合わせがリレーションシップとして存在し、どれも同じ見た目になる
type Bundle = { key: string; startIds: string[]; endIds: string[]; dashed: boolean; warn: boolean }
type Look = { dashed: boolean; warn: boolean }

// 束を作る（束の中のノード、束どうしの並びは compareNodes の順）。始点ごとに「繋がる終点の集まり」が同じ始点同士をまとめるか、
// 終点ごとに「繋がる始点の集まり」が同じ終点同士をまとめるか、束が少なく済むほうを使う。
// どちらも束の中は全組み合わせが繋がっているので、始点と終点の対応は失われない。
function buildBundles(
  rels: Relationship[],
  lookOf: (r: Relationship) => Look,
  compareNodes: (a: string, b: string) => number,
): Bundle[] {
  const group = (side: "start" | "end"): Bundle[] => {
    // 見た目ごと・片側のノードごとに、反対側のノードを集める
    const sets = new Map<string, { own: string; look: Look; others: Set<string> }>()
    for (const r of rels) {
      const look = lookOf(r)
      const own = side === "start" ? r.startNodeId : r.endNodeId
      const other = side === "start" ? r.endNodeId : r.startNodeId
      const k = `${look.dashed}|${look.warn}|${own}`
      const e = sets.get(k) ?? { own, look, others: new Set<string>() }
      e.others.add(other)
      sets.set(k, e)
    }
    // 反対側の集まり（と見た目）が同じもの同士をまとめる
    const bundles = new Map<string, { look: Look; owns: string[]; others: string[] }>()
    for (const e of sets.values()) {
      const others = [...e.others].sort()
      const k = `${e.look.dashed}|${e.look.warn}|${others.join(",")}`
      const b = bundles.get(k) ?? { look: e.look, owns: [], others }
      b.owns.push(e.own)
      bundles.set(k, b)
    }
    return [...bundles.entries()].map(([k, b]) => {
      const owns = [...b.owns].sort(compareNodes)
      const others = [...b.others].sort(compareNodes)
      return {
        key: `${side}|${k}`,
        startIds: side === "start" ? owns : others,
        endIds: side === "start" ? others : owns,
        ...b.look,
      }
    })
  }
  const byStart = group("start")
  const byEnd = group("end")
  const picked = byEnd.length < byStart.length ? byEnd : byStart
  return picked.sort((a, b) => compareNodes(a.startIds[0], b.startIds[0]) || compareNodes(a.endIds[0], b.endIds[0]))
}

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
  // ノードが消えていても、作成時のスナップショットで名前・ラベルを出す
  const nodeName = useCallback((id: string) => {
    const r = typeRels.find((x) => x.startNodeId === id || x.endNodeId === id)
    return nodeById.get(id)?.name ?? (r?.startNodeId === id ? r.startNodeName : r?.endNodeName) ?? id
  }, [nodeById, typeRels])
  const nodeLabelIds = useCallback((id: string) => {
    const r = typeRels.find((x) => x.startNodeId === id || x.endNodeId === id)
    return labelsOf(id, r?.startNodeId === id ? r.startNodeLabelIds : r?.endNodeLabelIds)
  }, [typeRels, labelsOf])

  // ノードの並びはノード管理の一覧と同じ（手で並べた順）。消えたノードは最後に名前順で。
  const nodeRank = useMemo(() => new Map(sortByOrder(nodes).map((n, i) => [n.id, i])), [nodes])
  const compareNodes = useCallback((a: string, b: string) =>
    (nodeRank.get(a) ?? Infinity) - (nodeRank.get(b) ?? Infinity) ||
    nodeName(a).localeCompare(nodeName(b), "ja"),
  [nodeRank, nodeName])

  const bundles = useMemo<Bundle[]>(() => {
    const q = normalizeName(nodeQuery)
    const shown = typeRels.filter((r) =>
      !q || normalizeName(r.startNodeName).includes(q) || normalizeName(r.endNodeName).includes(q))
    return buildBundles(
      shown,
      (r) => ({
        // 未確認のものは点線、スキーマに無い組み合わせは黄色
        dashed: deriveConfirmationStatus(r.confirmations).state === "unconfirmed",
        warn: !matchesSchema(r),
      }),
      compareNodes,
    )
  }, [typeRels, nodeQuery, matchesSchema, compareNodes])

  const mismatchCount = useMemo(() => typeRels.filter((r) => !matchesSchema(r)).length, [typeRels, matchesSchema])
  const endCount = useMemo(() => new Set(typeRels.map((r) => r.endNodeId)).size, [typeRels])
  const startCount = useMemo(() => new Set(typeRels.map((r) => r.startNodeId)).size, [typeRels])

  // 引き出し線。各ノードと中央のタイプの位置を測り、その間を曲線で結ぶ（スキーマ確認と同じ描き方）。
  const boardRef = useRef<HTMLDivElement>(null)
  const anchorRefs = useRef(new Map<string, HTMLElement>())
  const [paths, setPaths] = useState<({ key: string; d: string } & Look)[]>([])
  const [boardSize, setBoardSize] = useState({ w: 0, h: 0 })

  const measure = useCallback(() => {
    const board = boardRef.current
    if (!board) { setPaths([]); return }
    const b = board.getBoundingClientRect()
    const rel = (el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      return { left: r.left - b.left, right: r.right - b.left, y: r.top + r.height / 2 - b.top }
    }
    const curve = (x1: number, y1: number, x2: number, y2: number) => {
      const mx = (x1 + x2) / 2
      return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`
    }
    const next: ({ key: string; d: string } & Look)[] = []
    for (const bd of bundles) {
      const typeEl = anchorRefs.current.get(`type:${bd.key}`)
      if (!typeEl) continue
      const t = rel(typeEl)
      const look = { dashed: bd.dashed, warn: bd.warn }
      for (const id of bd.startIds) {
        const el = anchorRefs.current.get(`start:${bd.key}:${id}`)
        if (!el) continue
        const s = rel(el)
        // 始点 → タイプ（矢印はタイプに向く）
        next.push({ key: `s:${bd.key}:${id}`, d: curve(s.right, s.y, t.left - 1, t.y), ...look })
      }
      for (const id of bd.endIds) {
        const el = anchorRefs.current.get(`end:${bd.key}:${id}`)
        if (!el) continue
        const e = rel(el)
        // タイプ → 終点（矢印は終点に向く）
        next.push({ key: `e:${bd.key}:${id}`, d: curve(t.right, t.y, e.left - 1, e.y), ...look })
      }
    }
    setPaths(next)
    setBoardSize({ w: b.width, h: b.height })
  }, [bundles])

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
                      <span>束ねているのは、左右のノードがすべての組み合わせで繋がっているものだけです</span>
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-1 overflow-auto px-8 py-6">
                {typeRels.length === 0 ? (
                  <p className="m-auto p-4 text-center text-sm text-muted-foreground">
                    このタイプのリレーションシップはまだありません。
                  </p>
                ) : bundles.length === 0 ? (
                  <p className="m-auto p-4 text-center text-sm text-muted-foreground">該当するノードがありません</p>
                ) : (
                  <div ref={boardRef} className="relative mx-auto grid h-fit grid-cols-[auto_auto_auto] items-center gap-x-16 gap-y-8">
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

                    {bundles.map((bd) => (
                      <div key={bd.key} className="contents">
                        {/* 始点ノード */}
                        <div className="flex flex-col items-end gap-1.5">
                          {bd.startIds.map((id) => (
                            <span key={id} ref={setAnchor(`start:${bd.key}:${id}`)}>
                              <NodeBox name={nodeName(id)} labelIds={nodeLabelIds(id)} warn={bd.warn} />
                            </span>
                          ))}
                        </div>
                        {/* 中央：タイプ */}
                        <div className="flex justify-center">
                          <span ref={setAnchor(`type:${bd.key}`)}
                            className={cn(
                              "relative z-10 shrink-0 rounded-md border bg-background px-2 py-0.5 text-xs text-foreground",
                              bd.warn ? "border-amber-400 dark:border-amber-600" : "border-border",
                            )}>
                            {selectedType.name}
                          </span>
                        </div>
                        {/* 終点ノード */}
                        <div className="flex flex-col items-start gap-1.5">
                          {bd.endIds.map((id) => (
                            <span key={id} ref={setAnchor(`end:${bd.key}:${id}`)}>
                              <NodeBox name={nodeName(id)} labelIds={nodeLabelIds(id)} warn={bd.warn} />
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
