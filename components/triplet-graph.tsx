"use client"

// グラフビューの枠。描画本体(triplet-graph-canvas)は window 依存のため
// ssr:false で動的読み込みし、コンテナの実サイズを測って渡す（ResizeObserver）。
//
// 表示の絞り込みもここで持つ。何を出すかは「どの種類のノードを出すか」と
// 「どのリレーションを出すか」の2段で決める。絞り込んだ結果を描画本体へ渡すので、
// 描画側は絞り込みを知らなくていい。

import { useLayoutEffect, useEffect, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { line } from "@/lib/graph-colors"
import type { RelationCondition } from "@/lib/types"
import type { GraphEdge, GraphEndKind } from "@/lib/graph-edges"

const TripletGraphCanvas = dynamic(() => import("./triplet-graph-canvas"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-[#0a0b14]">
      <Loader2 className="h-6 w-6 animate-spin text-indigo-300" />
    </div>
  ),
})

// 絞り込みパネルのボタン。押すたびに出す／出さないが入れ替わる。
function FilterChip({
  on,
  label,
  count,
  dotColor,
  onClick,
}: {
  on: boolean
  label: string
  count?: number
  dotColor?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors",
        on
          ? "border-white/15 bg-white/10 text-zinc-100"
          : "border-white/[0.06] bg-transparent text-zinc-500 hover:bg-white/5",
      )}
    >
      <span
        className={cn("h-2 w-2 shrink-0 rounded-full transition-opacity", !on && "opacity-30")}
        style={{ backgroundColor: dotColor ?? "currentColor" }}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && <span className="shrink-0 tabular-nums text-[10px] text-zinc-500">{count}</span>}
    </button>
  )
}

export function TripletGraph({
  edges,
  classNameById,
  attrNameById,
  conditionsByRelationId,
  hueByClassId,
  hueByRelationId,
  rootClassIdById,
  relationOrder,
  onVisibleChange,
  onSelectNode,
}: {
  edges: GraphEdge[]
  classNameById: Map<string, string>
  attrNameById?: Map<string, string>
  conditionsByRelationId?: Map<string, RelationCondition[]>
  // クラス／リレーションごとの色（一覧の並び順で配ってある）
  hueByClassId?: Map<string, number>
  hueByRelationId?: Map<string, number>
  // クラスid → ルートクラスid（列の括りに使う）
  rootClassIdById?: Map<string, string>
  // リレーションid→名前。パネルの並びはリレーション管理の並び順に合わせる。
  relationOrder?: { id: string; name: string }[]
  // 絞り込んだあとの件数。上部に出す数が実際に見えているものと食い違わないように。
  onVisibleChange?: (counts: { nodes: number; edges: number }) => void
  onSelectNode?: (id: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 })

  // 出すノードの種類。どちらも既定は出す。
  const [kindsOff, setKindsOff] = useState<Set<GraphEndKind>>(new Set())
  // 出さないリレーション。既定は空＝全部出す。
  const [relationsOff, setRelationsOff] = useState<Set<string>>(new Set())

  const toggle = <T,>(set: Set<T>, key: T) => {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  }

  // ノードの種類で絞ったあとの線。リレーションの一覧はこれを数える
  // （クラスを隠したら、クラスにしか出てこないリレーションも一覧から消える）。
  const byKind = useMemo(
    () => edges.filter((e) => !kindsOff.has(e.source.kind) && !kindsOff.has(e.target.kind)),
    [edges, kindsOff],
  )

  const kindCounts = useMemo(() => {
    let cls = 0
    let inst = 0
    const seen = new Set<string>()
    for (const e of edges)
      for (const end of [e.source, e.target]) {
        const key = `${end.kind}:${end.id}`
        if (seen.has(key)) continue
        seen.add(key)
        if (end.kind === "class") cls++
        else inst++
      }
    return { class: cls, instance: inst }
  }, [edges])

  // パネルに出すリレーション。並びはリレーション管理に合わせ、そこに無いものは後ろへ。
  const relationRows = useMemo(() => {
    const counts = new Map<string, number>()
    const names = new Map<string, string>()
    for (const e of byKind) {
      counts.set(e.predicateRelationId, (counts.get(e.predicateRelationId) ?? 0) + 1)
      if (!names.has(e.predicateRelationId)) names.set(e.predicateRelationId, e.predicateName)
    }
    const known = (relationOrder ?? []).filter((r) => counts.has(r.id))
    const rest = [...counts.keys()]
      .filter((id) => !known.some((r) => r.id === id))
      .sort()
      .map((id) => ({ id, name: names.get(id) ?? "（定義なし）" }))
    return [...known, ...rest].map((r) => ({ ...r, count: counts.get(r.id) ?? 0 }))
  }, [byKind, relationOrder])

  const visible = useMemo(
    () => byKind.filter((e) => !relationsOff.has(e.predicateRelationId)),
    [byKind, relationsOff],
  )

  useEffect(() => {
    const ids = new Set<string>()
    for (const e of visible) {
      ids.add(`${e.source.kind}:${e.source.id}`)
      ids.add(`${e.target.kind}:${e.target.id}`)
    }
    onVisibleChange?.({ nodes: ids.size, edges: visible.length })
  }, [visible, onVisibleChange])

  // 初回は同期計測、以降は ResizeObserver で追従
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      setSize({ w: Math.floor(r.width), h: Math.floor(r.height) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 線が1本も無くなるような絞り込みをしたら、リレーションの選択は持ち越さない
  useEffect(() => {
    setRelationsOff((prev) => {
      const alive = new Set(byKind.map((e) => e.predicateRelationId))
      const next = new Set([...prev].filter((id) => alive.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [byKind])

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-[#0a0b14]">
      {edges.length === 0 ? (
        <div className="flex h-full w-full items-center justify-center text-sm text-zinc-400">
          トリプレットが登録されていません
        </div>
      ) : size.w > 0 && size.h > 0 ? (
        <TripletGraphCanvas
          edges={visible}
          classNameById={classNameById}
          attrNameById={attrNameById}
          conditionsByRelationId={conditionsByRelationId}
          hueByClassId={hueByClassId}
          hueByRelationId={hueByRelationId}
          rootClassIdById={rootClassIdById}
          width={size.w}
          height={size.h}
          onSelectNode={onSelectNode}
        />
      ) : null}

      {/* 表示の絞り込み（左） */}
      {edges.length > 0 && (
        <div className="absolute left-3 top-3 z-10 flex max-h-[calc(100%-5rem)] w-56 flex-col overflow-hidden rounded-xl border border-white/10 bg-black/50 shadow-xl backdrop-blur-md">
          <div className="space-y-1.5 px-3 pb-3 pt-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">表示ノード</p>
            <FilterChip
              on={!kindsOff.has("instance")}
              label="インスタンス"
              count={kindCounts.instance}
              dotColor="hsl(210, 45%, 62%)"
              onClick={() => setKindsOff((s) => toggle(s, "instance"))}
            />
            <FilterChip
              on={!kindsOff.has("class")}
              label="クラス"
              count={kindCounts.class}
              dotColor="hsl(275, 45%, 62%)"
              onClick={() => setKindsOff((s) => toggle(s, "class"))}
            />
          </div>
          <div className="mx-3 border-t border-white/[0.06]" />
          <div className="flex min-h-0 flex-col px-3 pb-3 pt-3">
            <div className="flex items-baseline justify-between pb-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">表示リレーション</p>
              {relationsOff.size > 0 && (
                <button
                  type="button"
                  onClick={() => setRelationsOff(new Set())}
                  className="text-[10px] text-zinc-400 transition-colors hover:text-zinc-100"
                >
                  全部出す
                </button>
              )}
            </div>
            <div className="min-h-0 space-y-1.5 overflow-y-auto">
              {relationRows.length === 0 ? (
                <p className="py-1 text-[11px] text-zinc-500">出せる線がありません</p>
              ) : (
                relationRows.map((r) => (
                  <FilterChip
                    key={r.id}
                    on={!relationsOff.has(r.id)}
                    label={r.name}
                    count={r.count}
                    dotColor={line(hueByRelationId?.get(r.id) ?? 210, 1)}
                    onClick={() => setRelationsOff((s) => toggle(s, r.id))}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 操作ヒント */}
      {edges.length > 0 && (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/40 px-2.5 py-1 text-[11px] text-zinc-300 backdrop-blur-sm">
          ドラッグでノード移動 ／ ホイールでズーム ／ ホバーで隣接強調
        </div>
      )}
    </div>
  )
}
