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
// 図の中央のタイプを押すと、右ペインにそのリレーションシップの詳細を出し、そこで編集できる
// （詳細パネルはリレーションシップ管理と共用）。束ねていて複数あるときは、右ペインで1件ずつ選んで見る。
// 同じタイプをもう一度押すと右ペインを閉じる。図の白紙部分を押しても閉じる。
// 右ペインを出している間は、選んだものを図の中で目立たせる。タイプを押したときは束全体を目立たせ、
// 右ペインの一覧で1件を選んだときは、その1件だけを目立たせる。
// ここからリレーションシップを追加することもできる（追加ダイアログはリレーションシップ管理と共用）。
//
// 定義したがまだ使っていないラベル・タイプ（エクスポートには影響しない参考情報）もここで見せる。

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, Info, Loader2, Plus, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { RelationshipAddDialog } from "@/components/relationship-add-dialog"
import { RelationshipDetailPanel } from "@/components/relationship-detail-panel"
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

// 束を作る。始点ごとに「繋がる終点の集まり」が同じ始点同士をまとめるか、
// 終点ごとに「繋がる始点の集まり」が同じ終点同士をまとめるか、束が少なく済むほうを使う。
// どちらも束の中は全組み合わせが繋がっているので、始点と終点の対応は失われない。
//
// 並びはリレーションシップ管理の一覧と同じにする（rels はその順で渡す）。
// 束どうしは、束の中でいちばん前にあるリレーションシップの順。
// 束の中のノードは、始点・終点それぞれで一覧に最初に出てくる順。
function buildBundles(rels: Relationship[], lookOf: (r: Relationship) => Look): Bundle[] {
  const firstIndex = (side: "start" | "end") => {
    const m = new Map<string, number>()
    rels.forEach((r, i) => {
      const id = side === "start" ? r.startNodeId : r.endNodeId
      if (!m.has(id)) m.set(id, i)
    })
    return m
  }
  const rank = { start: firstIndex("start"), end: firstIndex("end") }

  const group = (side: "start" | "end"): (Bundle & { first: number })[] => {
    const otherSide = side === "start" ? "end" : "start"
    // 見た目ごと・片側のノードごとに、反対側のノードを集める
    const sets = new Map<string, { own: string; look: Look; others: Set<string>; first: number }>()
    rels.forEach((r, i) => {
      const look = lookOf(r)
      const own = side === "start" ? r.startNodeId : r.endNodeId
      const other = side === "start" ? r.endNodeId : r.startNodeId
      const k = `${look.dashed}|${look.warn}|${own}`
      const e = sets.get(k) ?? { own, look, others: new Set<string>(), first: i }
      e.others.add(other)
      sets.set(k, e)
    })
    // 反対側の集まり（と見た目）が同じもの同士をまとめる
    const bundles = new Map<string, { look: Look; owns: string[]; others: string[]; first: number }>()
    for (const e of sets.values()) {
      const others = [...e.others].sort()
      const k = `${e.look.dashed}|${e.look.warn}|${others.join(",")}`
      const b = bundles.get(k) ?? { look: e.look, owns: [], others, first: e.first }
      b.owns.push(e.own)
      b.first = Math.min(b.first, e.first)
      bundles.set(k, b)
    }
    const by = (m: Map<string, number>) => (a: string, b: string) => (m.get(a) ?? 0) - (m.get(b) ?? 0)
    return [...bundles.entries()].map(([k, b]) => {
      const owns = [...b.owns].sort(by(rank[side]))
      const others = [...b.others].sort(by(rank[otherSide]))
      return {
        key: `${side}|${k}`,
        startIds: side === "start" ? owns : others,
        endIds: side === "start" ? others : owns,
        first: b.first,
        ...b.look,
      }
    })
  }
  const byStart = group("start")
  const byEnd = group("end")
  const picked = byEnd.length < byStart.length ? byEnd : byStart
  return picked.sort((a, b) => a.first - b.first)
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
  const [showAdd, setShowAdd] = useState(false)
  // 右ペインに出しているリレーションシップ。束の key は編集で見た目が変わると付け直されるので、
  // リレーションシップの id で持ち、束はそこから引く
  const [activeRelId, setActiveRelId] = useState<string | null>(null)
  // true：右ペインの一覧で1件を選んだ（その1件だけ目立たせる）。false：タイプを押して束ごと選んだ
  const [focusOne, setFocusOne] = useState(false)

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

  const bundles = useMemo<Bundle[]>(() => {
    const q = normalizeName(nodeQuery)
    const shown = sortByOrder(typeRels).filter((r) =>
      !q || normalizeName(r.startNodeName).includes(q) || normalizeName(r.endNodeName).includes(q))
    return buildBundles(
      shown,
      (r) => ({
        // 未確認のものは点線、スキーマに無い組み合わせは黄色
        dashed: deriveConfirmationStatus(r.confirmations).state === "unconfirmed",
        warn: !matchesSchema(r),
      }),
    )
  }, [typeRels, nodeQuery, matchesSchema])

  const relByEnds = useMemo(
    () => new Map(typeRels.map((r) => [`${r.startNodeId}|${r.endNodeId}`, r])),
    [typeRels],
  )
  const relsOf = (bd: Bundle) => bd.startIds.flatMap((s) =>
    bd.endIds.flatMap((e) => relByEnds.get(`${s}|${e}`) ?? []))

  const activeRel = activeRelId ? relationships.find((r) => r.id === activeRelId) ?? null : null
  const activeBundle = activeRel
    ? bundles.find((bd) => bd.startIds.includes(activeRel.startNodeId) && bd.endIds.includes(activeRel.endNodeId)) ?? null
    : null

  // 同じ束のタイプをもう一度押したら閉じる。別の束なら、その束の先頭のリレーションシップを出す
  const handleTypeClick = (bd: Bundle) => {
    setFocusOne(false)
    if (activeBundle?.key === bd.key) { setActiveRelId(null); return }
    setActiveRelId(relsOf(bd)[0]?.id ?? null)
  }

  // 図の中での目立たせ方。何か選んでいる間は、選んだ束以外を薄くする。
  // 束ごと選んだときは束の中をすべて目立たせ、1件を選んだときはその1件の始点・終点だけを目立たせる
  type Tone = "normal" | "active" | "dim"
  const toneOf = (bd: Bundle, nodeId?: string, side?: "start" | "end"): Tone => {
    if (!activeBundle) return "normal"
    if (bd.key !== activeBundle.key) return "dim"
    if (!nodeId || !activeRel || !focusOne) return "active"
    const hit = side === "start" ? activeRel.startNodeId === nodeId : activeRel.endNodeId === nodeId
    return hit ? "active" : "normal"
  }

  const mismatchCount = useMemo(() => typeRels.filter((r) => !matchesSchema(r)).length, [typeRels, matchesSchema])
  const endCount = useMemo(() => new Set(typeRels.map((r) => r.endNodeId)).size, [typeRels])
  const startCount = useMemo(() => new Set(typeRels.map((r) => r.startNodeId)).size, [typeRels])

  // 引き出し線。各ノードと中央のタイプの位置を測り、その間を曲線で結ぶ（スキーマ確認と同じ描き方）。
  const boardRef = useRef<HTMLDivElement>(null)
  const anchorRefs = useRef(new Map<string, HTMLElement>())
  type PathLine = { key: string; d: string; bundle: Bundle; nodeId: string; side: "start" | "end" } & Look
  const [paths, setPaths] = useState<PathLine[]>([])
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
    const next: PathLine[] = []
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
        next.push({ key: `s:${bd.key}:${id}`, d: curve(s.right, s.y, t.left - 1, t.y), bundle: bd, nodeId: id, side: "start", ...look })
      }
      for (const id of bd.endIds) {
        const el = anchorRefs.current.get(`end:${bd.key}:${id}`)
        if (!el) continue
        const e = rel(el)
        // タイプ → 終点（矢印は終点に向く）
        next.push({ key: `e:${bd.key}:${id}`, d: curve(t.right, t.y, e.left - 1, e.y), bundle: bd, nodeId: id, side: "end", ...look })
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
  const NodeBox = ({ name, labelIds, warn, tone = "normal" }: {
    name: string; labelIds: string[]; warn?: boolean; tone?: Tone
  }) => (
    <span data-graph-item className={cn(
      "relative z-10 block max-w-64 space-y-1 rounded-md border bg-background px-2 py-1 transition-opacity",
      tone === "active" ? "border-indigo-500 ring-2 ring-indigo-300 dark:ring-indigo-700"
        : warn ? "border-amber-400 dark:border-amber-600" : "border-border",
      tone === "dim" && "opacity-35",
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
        {currentProject && (
          <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-transparent"
            onClick={() => setShowAdd(true)}>
            <Plus className="h-3.5 w-3.5" />リレーションシップを追加
          </Button>
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
                      onClick={() => { setSelectedId(t.id); setNodeQuery(""); setActiveRelId(null) }}>
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
              onClick={() => { setSelectedId(UNUSED); setActiveRelId(null) }}>
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

              {/* 図の白紙部分（ノード・タイプ以外）を押したら選択を解除する */}
              <div className="flex flex-1 overflow-auto px-8 py-6"
                onClick={(e) => {
                  if (!(e.target as HTMLElement).closest("[data-graph-item]")) { setActiveRelId(null); setFocusOne(false) }
                }}>
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
                        {(["data-arrow", "data-arrow-warn", "data-arrow-active"] as const).map((id) => (
                          <marker key={id} id={id} viewBox="0 0 10 10" refX="9" refY="5"
                            markerWidth="7" markerHeight="7" orient="auto-start-reverse"
                            className={id === "data-arrow" ? "text-muted-foreground/60"
                              : id === "data-arrow-warn" ? "text-amber-500" : "text-indigo-500"}>
                            <path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="currentColor" strokeWidth="1.5" />
                          </marker>
                        ))}
                      </defs>
                      {paths.map((p) => {
                        const tone = toneOf(p.bundle, p.nodeId, p.side)
                        // 選んだリレーションシップの線（始点 → タイプ → 終点）を太く・色付きにする
                        const hit = tone === "active"
                        return (
                          <path key={p.key} d={p.d} fill="none" stroke="currentColor"
                            strokeWidth={hit ? 2.25 : 1.25}
                            className={cn(
                              hit ? "text-indigo-500" : p.warn ? "text-amber-500" : "text-muted-foreground/60",
                              tone === "dim" && "opacity-30",
                            )}
                            strokeDasharray={p.dashed ? "4 3" : undefined}
                            markerEnd={hit ? "url(#data-arrow-active)" : p.warn ? "url(#data-arrow-warn)" : "url(#data-arrow)"} />
                        )
                      })}
                    </svg>

                    {bundles.map((bd) => (
                      <div key={bd.key} className="contents">
                        {/* 始点ノード */}
                        <div className="flex flex-col items-end gap-1.5">
                          {bd.startIds.map((id) => (
                            <span key={id} ref={setAnchor(`start:${bd.key}:${id}`)}>
                              <NodeBox name={nodeName(id)} labelIds={nodeLabelIds(id)} warn={bd.warn}
                                tone={toneOf(bd, id, "start")} />
                            </span>
                          ))}
                        </div>
                        {/* 中央：タイプ */}
                        <div className="flex justify-center">
                          <button type="button" data-graph-item ref={setAnchor(`type:${bd.key}`)}
                            title={activeBundle?.key === bd.key ? "詳細を閉じる" : "詳細を見る・編集する"}
                            className={cn(
                              "relative z-10 shrink-0 rounded-md border bg-background px-2 py-0.5 text-xs text-foreground transition-colors hover:bg-muted",
                              toneOf(bd) === "active"
                                ? "border-indigo-500 bg-indigo-50 font-medium text-indigo-900 ring-2 ring-indigo-300 hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-100 dark:ring-indigo-700"
                                : bd.warn ? "border-amber-400 dark:border-amber-600" : "border-border",
                              toneOf(bd) === "dim" && "opacity-35",
                            )}
                            onClick={() => handleTypeClick(bd)}>
                            {selectedType.name}
                          </button>
                        </div>
                        {/* 終点ノード */}
                        <div className="flex flex-col items-start gap-1.5">
                          {bd.endIds.map((id) => (
                            <span key={id} ref={setAnchor(`end:${bd.key}:${id}`)}>
                              <NodeBox name={nodeName(id)} labelIds={nodeLabelIds(id)} warn={bd.warn}
                                tone={toneOf(bd, id, "end")} />
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

        {/* 右ペイン：選んだリレーションシップの詳細（リレーションシップ管理と共用のパネル） */}
        {activeRel && (
          <RelationshipDetailPanel key={activeRel.id} className="border-l border-border"
            relationship={activeRel} relationships={relationships}
            nodes={nodes} relTypes={relTypes} propertyDefs={data.propertyDefs} labelName={labelName}
            onUpdated={(updated) => setData((prev) => ({
              ...prev,
              relationships: prev.relationships.map((r) => (r.id === updated.id ? updated : r)),
            }))}
            onDeleted={(id) => {
              setData((prev) => ({ ...prev, relationships: prev.relationships.filter((r) => r.id !== id) }))
              setActiveRelId(null)
            }}
            header={(
              <div className="space-y-2 border-b border-border px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-foreground">{activeRel.relTypeName}</span>
                  <button type="button" aria-label="詳細を閉じる"
                    className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted"
                    onClick={() => { setActiveRelId(null); setFocusOne(false) }}>
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {/* 束ねているときは、束の中から見るものを選ぶ */}
                {activeBundle && relsOf(activeBundle).length > 1 && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      この束のリレーションシップ（{relsOf(activeBundle).length}件）
                    </p>
                    <div className="max-h-40 overflow-y-auto rounded-lg border border-border">
                      {relsOf(activeBundle).map((r) => (
                        <button key={r.id} type="button"
                          className={cn(
                            "block w-full truncate px-2.5 py-1.5 text-left text-xs transition-colors",
                            r.id === activeRel.id
                              ? "bg-indigo-100 text-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-100"
                              : "text-foreground hover:bg-muted",
                          )}
                          onClick={() => { setActiveRelId(r.id); setFocusOne(true) }}>
                          {nodeName(r.startNodeId)} → {nodeName(r.endNodeId)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )} />
        )}
      </div>

      <RelationshipAddDialog open={showAdd} onOpenChange={setShowAdd}
        projectId={projectId} relationships={relationships} nodes={nodes}
        orderedTypes={orderedTypes} labelName={labelName}
        initialTypeId={selectedType?.id}
        onCreated={(created) => setData((prev) => ({ ...prev, relationships: [...prev.relationships, created] }))} />
    </div>
  )
}
