"use client"

// トリプレットの力学グラフ描画本体（クライアント専用）。
//   react-force-graph-2d を top-level import するため、SSR を避ける目的で
//   triplet-graph.tsx から next/dynamic({ ssr:false }) 経由でのみ読み込む。
//   ノード=インスタンス（クラス色で発光）、エッジ=述語（湾曲＋流れる光の粒）。
//
//   配置は力学任せにせず、放射状ツリー（マインドマップ）で決め打ちする。
//   商品の構成のように1つのノードへ子が何十個もぶら下がる形だと、力学では
//   子が同じ半径に密集して名前もエッジ名も重なって読めなくなるため。
//   計算は lib/radial-layout.ts。ノードは fx/fy で固定し、掴めば動かせる。

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import ForceGraph2D from "react-force-graph-2d"
import type { Triplet, OntologyInstance, RelationCondition } from "@/lib/types"
import { formatRelationCondition } from "@/lib/relation-conditions"
import { hueForClass, NO_CLASS_HUE, neon, esc } from "@/lib/graph-colors"
import { radialTreeLayout } from "@/lib/radial-layout"

type GraphNode = {
  id: string
  name: string
  classId: string | null
  className: string
  color: string
  hue: number
  r: number
  // 放射状配置の結果（ラベルを外向きに置くのに使う）
  depth: number
  angle: number
  // d3-force が付与: x, y, vx, vy, fx, fy
  x?: number
  y?: number
  fx?: number
  fy?: number
}

type GraphLink = {
  id: string
  source: string | GraphNode
  target: string | GraphNode
  label: string
  predicateRelationId: string
  attributes: Record<string, string>
}

const MAX_ZOOM = 2.4 // 初期フィットの拡大率上限（少数ノードで拡大しすぎるのを防ぐ）
const MIN_ZOOM = 0.05 // 初期フィットの縮小率下限
const LINK_CURVATURE = 0.18 // エッジの湾曲（ラベル配置もこの値に合わせる）
const LABEL_MIN_ZOOM = 0.12 // これ以下に縮めたらラベルは出さない
const EDGE_LABEL_POS = 0.62 // エッジ名を置く位置（0=始点, 1=終点）。中心から離して重なりを減らす

type LabelRect = { x0: number; y0: number; x1: number; y1: number }

function linkEndNode(end: string | GraphNode): GraphNode | null {
  return typeof end === "object" ? end : null
}
function linkEndId(end: string | GraphNode): string {
  return typeof end === "object" ? end.id : end
}

export default function TripletGraphCanvas({
  triplets,
  instById,
  classNameById,
  attrNameById,
  conditionsByRelationId,
  width,
  height,
  onSelectNode,
}: {
  triplets: Triplet[]
  instById: Map<string, OntologyInstance>
  classNameById: Map<string, string>
  attrNameById?: Map<string, string>
  conditionsByRelationId?: Map<string, RelationCondition[]>
  width: number
  height: number
  onSelectNode?: (instanceId: string) => void
}) {
  const fgRef = useRef<any>(undefined)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [hoverLinkId, setHoverLinkId] = useState<string | null>(null)
  const [showEdgeLabels, setShowEdgeLabels] = useState(true)
  const hasFitRef = useRef(false) // 初期フィット済みか
  const userMovedRef = useRef(false) // ユーザーがズーム/パンしたか（以後は自動フィットしない）
  const programmaticRef = useRef(false) // 自分でズームした瞬間か（onZoom を無視するため）

  // triplets → {nodes, links} + 隣接情報
  const { data, adjacency } = useMemo(() => {
    const nodeMap = new Map<string, GraphNode>()
    const degree = new Map<string, number>()
    const adjacency = new Map<string, Set<string>>()

    const touch = (id: string, name: string, classId: string | null) => {
      if (!nodeMap.has(id)) {
        const inst = instById.get(id)
        const cid = inst?.classId ?? classId
        const cls = cid ? classNameById.get(cid) : undefined
        const hue = cid ? hueForClass(cid) : NO_CLASS_HUE
        nodeMap.set(id, {
          id,
          name: inst?.name ?? name,
          classId: cid,
          className: cls ?? "未分類",
          hue,
          color: `hsl(${hue}, 85%, 63%)`,
          r: 4,
          depth: 0,
          angle: 0,
        })
      }
      degree.set(id, (degree.get(id) ?? 0) + 1)
    }

    const links: GraphLink[] = []
    for (const t of triplets) {
      touch(t.subjectInstanceId, t.subjectName, t.subjectClassId)
      touch(t.objectInstanceId, t.objectName, t.objectClassId)
      links.push({
        id: t.id,
        source: t.subjectInstanceId,
        target: t.objectInstanceId,
        label: t.predicateName,
        predicateRelationId: t.predicateRelationId,
        attributes: t.attributes ?? {},
      })
      if (!adjacency.has(t.subjectInstanceId)) adjacency.set(t.subjectInstanceId, new Set())
      if (!adjacency.has(t.objectInstanceId)) adjacency.set(t.objectInstanceId, new Set())
      adjacency.get(t.subjectInstanceId)!.add(t.objectInstanceId)
      adjacency.get(t.objectInstanceId)!.add(t.subjectInstanceId)
    }

    // 次数でノード半径を決める（ハブほど大きい）
    for (const n of nodeMap.values()) {
      const d = degree.get(n.id) ?? 1
      n.r = 4 + Math.sqrt(d) * 2.4
    }

    // 放射状に配置して固定する（力学には位置を触らせない）
    const nodes = [...nodeMap.values()]
    const placement = radialTreeLayout(
      nodes.map((n) => n.id),
      links.map((l) => ({ source: linkEndId(l.source), target: linkEndId(l.target) })),
    )
    for (const n of nodes) {
      const p = placement.get(n.id)
      if (!p) continue
      n.x = p.x
      n.y = p.y
      n.fx = p.x
      n.fy = p.y
      n.depth = p.depth
      n.angle = p.angle
    }

    return { data: { nodes, links }, adjacency }
  }, [triplets, instById, classNameById])

  // 全ノードが収まる拡大率を自前で算出し、上限(MAX_ZOOM)でクランプしてフィット。
  // 位置は放射状レイアウトで決まっているので、描画側(getGraphBbox)を待たずに
  // 自分の座標から範囲を出す（描画前でも正しく収まる）。
  const fitToView = useCallback(
    (duration = 600) => {
      const fg = fgRef.current
      if (!fg || width <= 0 || height <= 0 || data.nodes.length === 0) return false
      let x0 = Infinity
      let x1 = -Infinity
      let y0 = Infinity
      let y1 = -Infinity
      for (const n of data.nodes) {
        if (n.x == null || n.y == null) return false
        x0 = Math.min(x0, n.x - n.r)
        x1 = Math.max(x1, n.x + n.r)
        y0 = Math.min(y0, n.y - n.r)
        y1 = Math.max(y1, n.y + n.r)
      }
      const spanX = x1 - x0
      const spanY = y1 - y0
      const pad = 80
      const zx = spanX > 0 ? (width - 2 * pad) / spanX : MAX_ZOOM
      const zy = spanY > 0 ? (height - 2 * pad) / spanY : MAX_ZOOM
      const z = Math.max(MIN_ZOOM, Math.min(zx, zy, MAX_ZOOM))
      programmaticRef.current = true
      fg.centerAt((x0 + x1) / 2, (y0 + y1) / 2, duration)
      fg.zoom(z, duration)
      window.setTimeout(() => { programmaticRef.current = false }, duration + 120)
      return true
    },
    [data, width, height],
  )

  // データ/サイズ変更でフィット状態をリセット
  useEffect(() => {
    hasFitRef.current = false
    userMovedRef.current = false
  }, [data, width, height])

  // 一度だけ全体を収める（ユーザーがズーム/パンしたら以後は触らない）。
  // 描画の初期化が終わる前に呼ぶと効かないことがあるので、少しの間はやり直す。
  useEffect(() => {
    if (width <= 0 || height <= 0) return
    let tries = 0
    const iv = window.setInterval(() => {
      if (userMovedRef.current || tries++ > 12) {
        window.clearInterval(iv)
        return
      }
      if (fitToView(tries <= 1 ? 0 : 400)) hasFitRef.current = true
      if (tries >= 4) window.clearInterval(iv)
    }, 150)
    return () => window.clearInterval(iv)
  }, [data, width, height, fitToView])

  // 位置は放射状レイアウトで決めているので、力学は全て外す
  // （残しておくと固定ノードの周りで粒子計算だけが走り続ける）
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    try {
      fg.d3Force("charge", null)
      fg.d3Force("link", null)
      fg.d3Force("center", null)
    } catch {
      /* noop */
    }
  }, [data, width, height])

  // ホバー中の対象（エッジ優先。エッジをホバーしたらそのトリプレットの両端ノードのみ強調）
  const hoverLink = hoverLinkId ? data.links.find((l) => l.id === hoverLinkId) ?? null : null
  const hovering = !!hoverId || !!hoverLink

  const isNodeHi = useCallback(
    (id: string) => {
      if (hoverLink) return linkEndId(hoverLink.source) === id || linkEndId(hoverLink.target) === id
      if (!hoverId) return true
      return id === hoverId || !!adjacency.get(hoverId)?.has(id)
    },
    [hoverId, hoverLink, adjacency],
  )
  const isLinkHi = useCallback(
    (l: GraphLink) => {
      if (hoverLink) return l.id === hoverLink.id
      if (!hoverId) return true
      return linkEndId(l.source) === hoverId || linkEndId(l.target) === hoverId
    },
    [hoverId, hoverLink],
  )

  // ラベルの重なり防止。1フレームごとに場所を取り合い、先に取った方だけが描かれる。
  // 名前が読めないほど重なるくらいなら、間引いて読める分だけ出す方がよい。
  const labelRectsRef = useRef<LabelRect[]>([])
  const nodeLabelOkRef = useRef<Set<string>>(new Set())

  const claimRect = useCallback((rect: LabelRect) => {
    for (const r of labelRectsRef.current) {
      if (rect.x0 < r.x1 && rect.x1 > r.x0 && rect.y0 < r.y1 && rect.y1 > r.y0) return false
    }
    labelRectsRef.current.push(rect)
    return true
  }, [])

  // ノード名をどこへ出すか。根は真下、それ以外は中心から外向きに逃がす（マインドマップの読み方）。
  const nodeLabelAnchor = useCallback((node: GraphNode, globalScale: number) => {
    const x = node.x ?? 0
    const y = node.y ?? 0
    const fontSize = Math.max(11 / globalScale, 3)
    const gap = node.r + 5 / globalScale
    if (node.depth === 0) {
      return { x, y: y + gap, align: "center" as CanvasTextAlign, baseline: "top" as CanvasTextBaseline, fontSize }
    }
    const right = Math.cos(node.angle) >= 0
    return {
      x: x + Math.cos(node.angle) * gap,
      y: y + Math.sin(node.angle) * gap,
      align: (right ? "left" : "right") as CanvasTextAlign,
      baseline: "middle" as CanvasTextBaseline,
      fontSize,
    }
  }, [])

  const labelRectAt = (
    anchor: { x: number; y: number; align: CanvasTextAlign; baseline: CanvasTextBaseline; fontSize: number },
    width: number,
  ): LabelRect => {
    const x0 = anchor.align === "left" ? anchor.x : anchor.align === "right" ? anchor.x - width : anchor.x - width / 2
    const y0 = anchor.baseline === "top" ? anchor.y : anchor.y - anchor.fontSize / 2
    return { x0, y0, x1: x0 + width, y1: y0 + anchor.fontSize }
  }

  // 描画の最初に、ノード名の席を先に押さえる（エッジ名よりノード名を優先する）。
  const handleRenderPre = useCallback(
    (ctx: CanvasRenderingContext2D, globalScale: number) => {
      labelRectsRef.current = []
      const ok = new Set<string>()
      if (globalScale > LABEL_MIN_ZOOM || hovering) {
        const fontSize = Math.max(11 / globalScale, 3)
        ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`
        // 中心に近いノードから席を取る（幹の名前を先に残す）
        const ordered = [...data.nodes].sort((a, b) => a.depth - b.depth)
        for (const node of ordered) {
          if (hovering && !isNodeHi(node.id)) continue
          const anchor = nodeLabelAnchor(node, globalScale)
          if (claimRect(labelRectAt(anchor, ctx.measureText(node.name).width))) ok.add(node.id)
        }
      }
      nodeLabelOkRef.current = ok
    },
    [data, hovering, isNodeHi, nodeLabelAnchor, claimRect],
  )

  const paintNode = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = node.x ?? 0
      const y = node.y ?? 0
      const hi = isNodeHi(node.id)
      const alpha = hi ? 1 : 0.15

      // 発光（グロー）
      ctx.globalAlpha = alpha
      ctx.shadowColor = node.color
      ctx.shadowBlur = hi ? (node.id === hoverId ? 26 : 16) : 6
      ctx.beginPath()
      ctx.arc(x, y, node.r, 0, 2 * Math.PI)
      ctx.fillStyle = node.color
      ctx.fill()
      ctx.shadowBlur = 0

      // 明るいコア
      ctx.beginPath()
      ctx.arc(x, y, node.r * 0.42, 0, 2 * Math.PI)
      ctx.fillStyle = "rgba(255,255,255,0.9)"
      ctx.fill()

      // ラベル（席を取れたものだけ。場所取りは handleRenderPre で済ませてある）
      if (nodeLabelOkRef.current.has(node.id)) {
        const anchor = nodeLabelAnchor(node, globalScale)
        ctx.font = `${anchor.fontSize}px ui-sans-serif, system-ui, sans-serif`
        ctx.textAlign = anchor.align
        ctx.textBaseline = anchor.baseline
        ctx.fillStyle = hi ? "rgba(235,240,255,0.92)" : "rgba(160,170,200,0.4)"
        ctx.fillText(node.name, anchor.x, anchor.y)
      }
      ctx.globalAlpha = 1
    },
    [isNodeHi, hoverId, hovering, nodeLabelAnchor],
  )

  const paintNodePointerArea = useCallback(
    (node: GraphNode, color: string, ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(node.x ?? 0, node.y ?? 0, node.r + 2, 0, 2 * Math.PI)
      ctx.fill()
    },
    [],
  )

  // エッジのラベル（述語名）を曲線の中点付近に描く。線・粒はデフォルト描画に任せ、
  // このコールバックは 'after' モードでラベルだけを重ねる。
  const paintLinkLabel = useCallback(
    (link: GraphLink, ctx: CanvasRenderingContext2D, globalScale: number) => {
      if (!showEdgeLabels) return
      const s = linkEndNode(link.source)
      const t = linkEndNode(link.target)
      if (!s || !t || s.x == null || s.y == null || t.x == null || t.y == null) return
      const hi = isLinkHi(link)
      if (hovering && !hi) return // ホバー中は対象エッジのラベルのみ

      const label = link.label
      if (!label) return
      if (globalScale <= LABEL_MIN_ZOOM && !hi) return

      // 中点ではなく終点寄りに置く。同じ述語の辺が1つのノードから何十本も出る形だと、
      // 中点はすべて中心付近に集まってしまい、同じ文字が折り重なる。
      const dx = t.x - s.x
      const dy = t.y - s.y
      const len = Math.hypot(dx, dy) || 1
      const mx = s.x + dx * EDGE_LABEL_POS
      const my = s.y + dy * EDGE_LABEL_POS
      // 曲線(二次ベジェ)の膨らみに合わせて線の上に載せる
      const bulge = 4 * EDGE_LABEL_POS * (1 - EDGE_LABEL_POS) * LINK_CURVATURE * 0.5
      const lx = mx + (-dy / len) * len * bulge
      const ly = my + (dx / len) * len * bulge

      const fontSize = Math.max(13 / globalScale, 2)
      ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`
      const tw = ctx.measureText(label).width
      const padX = 3 / globalScale
      const padY = 1.5 / globalScale
      // 席が空いていなければ出さない（重ねて読めなくするより間引く）。
      // ホバーで名指しした1本だけは、重なっていても必ず出す。
      const rect = {
        x0: lx - tw / 2 - padX,
        y0: ly - fontSize / 2 - padY,
        x1: lx + tw / 2 + padX,
        y1: ly + fontSize / 2 + padY,
      }
      // 席取りは描く枠より一回り大きく見る。同じ述語が何十本も並ぶと、
      // 枠が接していなくても字が詰まって読みにくいため、隙間を強制する。
      const gapX = 12 / globalScale
      const gapY = 6 / globalScale
      const focused = hoverLinkId === link.id
      if (
        !focused &&
        !claimRect({ x0: rect.x0 - gapX, y0: rect.y0 - gapY, x1: rect.x1 + gapX, y1: rect.y1 + gapY })
      )
        return

      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      // 背景（可読性のため半透明の下地）
      ctx.fillStyle = hi ? "rgba(10,11,20,0.85)" : "rgba(10,11,20,0.72)"
      ctx.fillRect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0)
      ctx.fillStyle = hi ? "rgba(235,240,255,1)" : "rgba(210,218,240,0.9)"
      ctx.fillText(label, lx, ly)
    },
    [isLinkHi, hovering, showEdgeLabels, claimRect, hoverLinkId],
  )

  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      const fg = fgRef.current
      if (fg && node.x != null && node.y != null) {
        programmaticRef.current = true
        fg.centerAt(node.x, node.y, 500)
        window.setTimeout(() => { programmaticRef.current = false }, 620)
      }
      onSelectNode?.(node.id)
    },
    [onSelectNode],
  )

  const handleNodeDragEnd = useCallback((node: GraphNode) => {
    userMovedRef.current = true // 以後は自動フィットしない
    // ドロップ位置に固定（放射状の配置から動かしたぶんはそのまま残す）
    node.fx = node.x
    node.fy = node.y
  }, [])

  return (
    <div className="relative" style={{ width, height }}>
      <div className="absolute right-3 top-3 z-10 flex gap-1.5">
        <button
          type="button"
          onClick={() => { userMovedRef.current = false; fitToView(500) }}
          className="rounded-md border border-white/15 bg-black/50 px-2.5 py-1 text-xs text-zinc-200 backdrop-blur-sm transition-colors hover:bg-black/70"
        >
          全体表示
        </button>
        <button
          type="button"
          onClick={() => setShowEdgeLabels((v) => !v)}
          className="rounded-md border border-white/15 bg-black/50 px-2.5 py-1 text-xs text-zinc-200 backdrop-blur-sm transition-colors hover:bg-black/70"
        >
          エッジ名: {showEdgeLabels ? "ON" : "OFF"}
        </button>
      </div>
      <ForceGraph2D
      ref={fgRef}
      width={width}
      height={height}
      graphData={data}
      backgroundColor="#0a0b14"
      nodeRelSize={1}
      nodeVal={((n: GraphNode) => n.r * n.r) as any}
      nodeCanvasObject={paintNode as any}
      nodePointerAreaPaint={paintNodePointerArea as any}
      nodeLabel={((n: GraphNode) => `<div class="gv-tt-name">${esc(n.name)}</div><div class="gv-tt-sub">${esc(n.className)}</div>`) as any}
      linkLabel={((l: GraphLink) => {
        const head =
          `<div class="gv-tt-name">${esc(l.label)}</div>` +
          `<div class="gv-tt-sub">${esc(linkEndNode(l.source)?.name ?? "")} → ${esc(linkEndNode(l.target)?.name ?? "")}</div>`
        // このトリプレット（エッジ）固有の属性値を「属性名：値」で表示（値が入っているものだけ）
        const rows = Object.entries(l.attributes ?? {})
          .filter(([, v]) => v != null && String(v).trim() !== "")
          .map(
            ([id, v]) =>
              `<span class="gv-tt-attr-key">${esc(attrNameById?.get(id) ?? id)}</span>` +
              `<span class="gv-tt-attr-val">${esc(String(v))}</span>`,
          )
        // 述語リレーションに紐づく成立条件を日本語1行の箇条書きで表示
        const conds = conditionsByRelationId?.get(l.predicateRelationId) ?? []
        const condHtml = conds.length
          ? `<div class="gv-tt-cond-title">成立条件（すべて満たす場合）</div>` +
            conds
              .map(
                (c) =>
                  `<div class="gv-tt-cond-row">` +
                  `<span class="gv-tt-cond-bullet">・</span>` +
                  `<span class="gv-tt-cond-text">${esc(formatRelationCondition(c))}</span>` +
                  `</div>`,
              )
              .join("")
          : ""
        const attrsHtml = rows.length ? `<div class="gv-tt-attrs">${rows.join("")}</div>` : ""
        return `${head}${attrsHtml}${condHtml}`
      }) as any}
      linkColor={((l: GraphLink) => {
        const hue = linkEndNode(l.source)?.hue ?? 210
        // 常時見える線。ホバー時は対象を明るく・非対象を暗く。
        if (!hovering) return neon(hue, 0.4)
        return isLinkHi(l) ? neon(hue, 0.9) : "rgba(120,130,180,0.05)"
      }) as any}
      linkWidth={((l: GraphLink) => (isLinkHi(l) ? 2.2 : 1.2)) as any}
      linkCurvature={LINK_CURVATURE}
      linkCanvasObjectMode={(() => "after") as any}
      linkCanvasObject={paintLinkLabel as any}
      linkDirectionalArrowLength={((l: GraphLink) => (isLinkHi(l) ? 7 : 5.5)) as any}
      linkDirectionalArrowRelPos={1}
      linkDirectionalArrowColor={((l: GraphLink) => {
        const hue = linkEndNode(l.source)?.hue ?? 210
        if (!hovering) return neon(hue, 0.9)
        return isLinkHi(l) ? neon(hue, 0.95) : "rgba(120,130,180,0.05)"
      }) as any}
      linkDirectionalParticles={((l: GraphLink) => (!hovering || isLinkHi(l) ? 2 : 0)) as any}
      linkDirectionalParticleWidth={((l: GraphLink) => (isLinkHi(l) ? 3 : 2)) as any}
      linkDirectionalParticleSpeed={0.006}
      linkDirectionalParticleColor={((l: GraphLink) => neon(linkEndNode(l.source)?.hue ?? 210, 0.95)) as any}
      onNodeHover={(n: GraphNode | null) => setHoverId(n?.id ?? null)}
      onLinkHover={((l: GraphLink | null) => setHoverLinkId(l?.id ?? null)) as any}
      onNodeClick={handleNodeClick as any}
      onNodeDragEnd={handleNodeDragEnd as any}
      onZoom={(() => {
        // ユーザーがズーム/パンしたら自動フィットを止める（勝手に戻さない）。
        // 初期化のときにも1度発火するので、最初のフィットが済むまでは数えない。
        if (!programmaticRef.current && hasFitRef.current) userMovedRef.current = true
      }) as any}
      onRenderFramePre={handleRenderPre as any}
      warmupTicks={0}
      cooldownTicks={0}
      />
    </div>
  )
}
