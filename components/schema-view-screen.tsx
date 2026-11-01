"use client"

// スキーマ確認（スキーマ設計）。ラベルを1つ選び、そのラベルに関わるリレーションシップタイプだけを見る。
//
// 【全体図にしない理由】ラベルとラベルペアを全部1枚に描くと、数十ラベル・数百本の線が重なって
// 何も読めなくなる。設計中に知りたいのは「このラベルは何と、どのタイプで繋がれるか」なので、
// 1ラベルを中心に、入ってくるタイプと出ていくタイプだけを並べる。
// 全体の形を見たいときは、取り込んだあと Neo4j の db.schema.visualization() で見られる。
//
// 相手のラベルを押すと、そのラベルに中心が移る（たどって見ていける）。
// 中心のラベルから各タイプへは、マインドマップのように引き出し線（曲線）を描いて繋ぐ。

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Loader2, Search } from "lucide-react"
import { TopBar } from "@/components/top-bar"
import { Input } from "@/components/ui/input"
import { LabelChip } from "@/components/label-chip"
import { cn } from "@/lib/utils"
import { normalizeName } from "@/lib/normalize"
import { useProject } from "@/app/project-context"
import { useListOrder } from "@/components/use-list-order"
import type { Label, RelationshipType } from "@/lib/graph-types"

// 中心のラベルから見た1タイプ分（同じタイプの相手ラベルはまとめて1行にする）
type Edge = { relType: RelationshipType; partnerIds: string[] }

export function SchemaViewScreen({ active }: { active?: boolean }) {
  const { currentProject, loading: projectLoading } = useProject()
  const projectId = currentProject?.id

  const [labels, setLabels] = useState<Label[]>([])
  const [relTypes, setRelTypes] = useState<RelationshipType[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState("")

  const fetchAll = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const [labelList, typeList] = await Promise.all([
        fetch(`/api/labels?projectId=${projectId}`).then((r) => r.json()),
        fetch(`/api/relationship-types?projectId=${projectId}`).then((r) => r.json()),
      ])
      setLabels(Array.isArray(labelList) ? labelList : [])
      setRelTypes(Array.isArray(typeList) ? typeList : [])
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (projectLoading) return
    setLabels([]); setRelTypes([]); setSelectedId(null)
    setLoading(!!projectId)
  }, [projectId, projectLoading])

  useEffect(() => {
    if (active && projectId) fetchAll()
  }, [active, projectId, fetchAll])

  const labelById = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels])
  const labelName = useCallback((id: string) => labelById.get(id)?.name ?? "（削除済み）", [labelById])

  // ラベルごとの、始点・終点に持つリレーションシップタイプの数（左の一覧に出す）。
  // 右の図で中心から出る枝の数と同じになる（左右両方に出るタイプは2本）。
  const degree = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of relTypes) {
      const asSource = new Set<string>()
      const asTarget = new Set<string>()
      for (const p of t.labelPairs ?? []) {
        asSource.add(p.sourceLabelId)
        // 始点・終点とも自分のものは右側にだけ出すので、終点としては数えない
        if (p.targetLabelId !== p.sourceLabelId) asTarget.add(p.targetLabelId)
      }
      // 始点側は右の枝、終点側は左の枝として1本ずつ数える
      for (const id of asSource) m.set(id, (m.get(id) ?? 0) + 1)
      for (const id of asTarget) m.set(id, (m.get(id) ?? 0) + 1)
    }
    return m
  }, [relTypes])

  // 最初に開いたときは、いちばん多く繋がっているラベルを中心にする
  useEffect(() => {
    if (selectedId && labelById.has(selectedId)) return
    if (labels.length === 0) return
    const top = [...labels]
      .filter((l) => !l.system)
      .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))[0]
    if (top) setSelectedId(top.id)
  }, [labels, degree, selectedId, labelById])

  // 左の一覧はラベル管理と同じ並び（ラベルグループの順、その中は手で並べた順）にする
  const { grouped: labelGroups } = useListOrder(labels, projectId, "class", active)
  const listedGroups = useMemo(() => {
    const q = normalizeName(query)
    const hit = (l: Label) => !l.system &&
      (!q || normalizeName(l.name).includes(q) || normalizeName(l.nameEn ?? "").includes(q))
    return labelGroups
      .map((g) => ({ ...g, items: g.items.filter(hit) }))
      .filter((g) => g.items.length > 0)
  }, [labelGroups, query])

  // 中心のラベルが終点になるもの（左に並べる）と始点になるもの（右に並べる）に分ける。
  // 始点・終点とも自分自身のものは右に入れる（相手のチップが自分になる）。
  const { incoming, outgoing } = useMemo(() => {
    const inMap = new Map<string, Edge>()
    const outMap = new Map<string, Edge>()
    if (!selectedId) return { incoming: [], outgoing: [] }
    const add = (m: Map<string, Edge>, t: RelationshipType, partnerId: string) => {
      const e = m.get(t.id) ?? { relType: t, partnerIds: [] }
      if (!e.partnerIds.includes(partnerId)) e.partnerIds.push(partnerId)
      m.set(t.id, e)
    }
    for (const t of relTypes) {
      for (const p of t.labelPairs ?? []) {
        const isSource = p.sourceLabelId === selectedId
        const isTarget = p.targetLabelId === selectedId
        if (isSource) add(outMap, t, p.targetLabelId)
        else if (isTarget) add(inMap, t, p.sourceLabelId)
      }
    }
    const byName = (a: string, b: string) => labelName(a).localeCompare(labelName(b), "ja")
    const finish = (m: Map<string, Edge>) => [...m.values()]
      .map((e) => ({ ...e, partnerIds: [...e.partnerIds].sort(byName) }))
      .sort((a, b) => a.relType.name.localeCompare(b.relType.name, "ja"))
    return {
      incoming: finish(inMap),
      outgoing: finish(outMap),
    }
  }, [relTypes, selectedId, labelName])

  const selected = selectedId ? labelById.get(selectedId) ?? null : null

  // 相手のラベル（押すとそのラベルに中心が移る）
  const PartnerChip = ({ id }: { id: string }) => id === selectedId ? (
    <LabelChip name={labelName(id)} className="shrink-0" />
  ) : (
    <button type="button" className="max-w-full shrink-0 rounded-full transition-opacity hover:opacity-70"
      title={`${labelName(id)}を中心にする`} onClick={() => setSelectedId(id)}>
      <LabelChip name={labelName(id)} />
    </button>
  )

  // 引き出し線。中心のチップと各行の端の位置を測り、その間を曲線で結ぶ。
  const boardRef = useRef<HTMLDivElement>(null)
  const centerRef = useRef<HTMLDivElement>(null)
  const anchorRefs = useRef(new Map<string, HTMLElement>())
  const [paths, setPaths] = useState<{ key: string; d: string; arrow: boolean }[]>([])
  const [boardSize, setBoardSize] = useState({ w: 0, h: 0 })

  const measure = useCallback(() => {
    const board = boardRef.current
    const center = centerRef.current
    if (!board || !center) { setPaths([]); return }
    const b = board.getBoundingClientRect()
    const c = center.getBoundingClientRect()
    const cy = c.top + c.height / 2 - b.top
    const next: { key: string; d: string; arrow: boolean }[] = []
    const curve = (x1: number, y1: number, x2: number, y2: number) => {
      const mx = (x1 + x2) / 2
      return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`
    }
    const rel = (el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      return { left: r.left - b.left, right: r.right - b.left, y: r.top + r.height / 2 - b.top }
    }
    for (const [key, el] of anchorRefs.current) {
      const [kind, typeId] = key.split(":")
      const r = rel(el)
      if (kind === "in") {
        // 左のタイプ → 中心（矢印は中心に向く）
        next.push({ key, arrow: true, d: curve(r.right, r.y, c.left - b.left - 1, cy) })
      } else if (kind === "out") {
        // 中心 → 右のタイプ
        next.push({ key, arrow: false, d: curve(c.right - b.left, cy, r.left, r.y) })
      } else {
        const typeEl = anchorRefs.current.get(`${kind === "inleaf" ? "in" : "out"}:${typeId}`)
        if (!typeEl) continue
        const t = rel(typeEl)
        next.push(kind === "inleaf"
          // 相手のラベル → 左のタイプ
          ? { key, arrow: false, d: curve(r.right, r.y, t.left, t.y) }
          // 右のタイプ → 相手のラベル（矢印は相手に向く）
          : { key, arrow: true, d: curve(t.right, t.y, r.left - 1, r.y) })
      }
    }
    setPaths(next)
    setBoardSize({ w: b.width, h: b.height })
  }, [])

  useLayoutEffect(() => { measure() }, [measure, incoming, outgoing, selectedId, active])

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

  return (
    <div className="flex h-full flex-col">
      <TopBar group="スキーマ設計" title="スキーマ確認">
        {!loading && currentProject && (
          <span className="text-xs text-muted-foreground">
            ラベル {labels.filter((l) => !l.system).length}・タイプ {relTypes.length}
          </span>
        )}
      </TopBar>

      <div className="flex flex-1 overflow-hidden">
        {/* 左：中心にするラベルを選ぶ */}
        <div className="flex w-64 shrink-0 flex-col overflow-hidden border-r border-border">
          <div className="space-y-2 px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">ラベル</h2>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="ラベル名で検索" className="h-8 pl-7" />
            </div>
          </div>
          <div className="flex items-center justify-between px-4.5 pb-1 text-xs text-muted-foreground">
            <span>ラベル名</span>
            <span>タイプ数</span>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-4">
            {listedGroups.map((g) => (
              <div key={g.key} className="mb-2">
                <div className="flex items-center gap-1.5 px-2.5 pb-1 pt-2 text-xs">
                  <span className="h-2 w-2 shrink-0 rounded-full border border-border"
                    style={g.color ? { backgroundColor: g.color } : undefined} />
                  <span className="text-muted-foreground">ラベルグループ：</span>
                  <span className="truncate font-semibold text-foreground">{g.name}</span>
                </div>
                {g.items.map((l) => {
                  const d = degree.get(l.id) ?? 0
                  return (
                    <button key={l.id} type="button"
                      className={cn(
                        "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                        selectedId === l.id
                          ? "bg-indigo-100 text-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-100"
                          : "hover:bg-muted",
                        d === 0 && selectedId !== l.id && "text-muted-foreground",
                      )}
                      onClick={() => setSelectedId(l.id)}>
                      <span className="truncate">{l.name}</span>
                      <span className="ml-2 shrink-0 text-xs text-muted-foreground">{d}</span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        {/* 右：中心のラベルに関わるタイプ */}
        <div className="flex flex-1 overflow-auto px-8 py-6">
          {loading && labels.length === 0 ? (
            <div className="m-auto flex h-32 items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : !currentProject ? (
            <p className="m-auto p-4 text-center text-sm text-muted-foreground">プロジェクトを選択してください</p>
          ) : !selected ? (
            <p className="m-auto p-4 text-center text-sm text-muted-foreground">左からラベルを選んでください</p>
          ) : (
            incoming.length === 0 && outgoing.length === 0 ? (
              <div className="m-auto flex flex-col items-center gap-3 py-12">
                <LabelChip name={selected.name} className="px-3 py-1 text-sm" />
                <p className="text-sm text-muted-foreground">
                  このラベルを始点・終点にするリレーションシップタイプはまだありません。
                </p>
              </div>
            ) : (
              <div ref={boardRef}
                className="relative m-auto grid grid-cols-[auto_auto_auto] items-center gap-x-20">
                {/* 引き出し線 */}
                <svg className="pointer-events-none absolute inset-0 text-muted-foreground/60"
                  width={boardSize.w} height={boardSize.h} aria-hidden>
                  <defs>
                    <marker id="schema-arrow" viewBox="0 0 10 10" refX="9" refY="5"
                      markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                      <path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="currentColor" strokeWidth="1.5" />
                    </marker>
                  </defs>
                  {paths.map((p) => (
                    <path key={p.key} d={p.d} fill="none" stroke="currentColor" strokeWidth="1.25"
                      markerEnd={p.arrow ? "url(#schema-arrow)" : undefined} />
                  ))}
                </svg>

                {/* 左：中心のラベルが終点になるタイプ */}
                <div className="space-y-4">
                  {incoming.map((e) => (
                    <div key={e.relType.id} className="flex items-center justify-end gap-12">
                      <div className="flex flex-col items-end gap-1">
                        {e.partnerIds.map((id) => (
                          <span key={id} ref={setAnchor(`inleaf:${e.relType.id}:${id}`)} className="relative z-10">
                            <PartnerChip id={id} />
                          </span>
                        ))}
                      </div>
                      <span ref={setAnchor(`in:${e.relType.id}`)}
                        className="relative z-10 shrink-0 rounded-md border border-border bg-background px-2 py-0.5 text-xs text-foreground">
                        {e.relType.name}
                      </span>
                    </div>
                  ))}
                </div>

                {/* 中央：中心のラベル */}
                <div ref={centerRef} className="relative z-10">
                  <LabelChip name={selected.name}
                    className="border-indigo-400 bg-indigo-50 px-4 py-1.5 text-base font-semibold shadow-sm dark:border-indigo-600 dark:bg-indigo-950" />
                </div>

                {/* 右：中心のラベルが始点になるタイプ */}
                <div className="space-y-4">
                  {outgoing.map((e) => (
                    <div key={e.relType.id} className="flex items-center gap-12">
                      <span ref={setAnchor(`out:${e.relType.id}`)}
                        className="relative z-10 shrink-0 rounded-md border border-border bg-background px-2 py-0.5 text-xs text-foreground">
                        {e.relType.name}
                      </span>
                      <div className="flex flex-col items-start gap-1">
                        {e.partnerIds.map((id) => (
                          <span key={id} ref={setAnchor(`outleaf:${e.relType.id}:${id}`)} className="relative z-10">
                            <PartnerChip id={id} />
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}
