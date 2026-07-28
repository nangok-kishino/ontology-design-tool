"use client"

// トリプレットの力学グラフ描画本体（クライアント専用）。
//   react-force-graph-2d を top-level import するため、SSR を避ける目的で
//   triplet-graph.tsx から next/dynamic({ ssr:false }) 経由でのみ読み込む。
//   ノード=インスタンス（クラス色で発光）、エッジ=述語（湾曲＋流れる光の粒）。
//   ドラッグすると d3-force が再加熱し、グラフ全体が追従して動く（Neo4j踏襲）。

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import ForceGraph2D from "react-force-graph-2d"
import type { Triplet, OntologyInstance } from "@/lib/types"

type GraphNode = {
  id: string
  name: string
  classId: string | null
  className: string
  color: string
  hue: number
  r: number
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
}

// classId 文字列から決定的に色相(hue)を作る。暗背景で映えるネオン色に使う。
function hueForClass(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return h % 360
}
const NO_CLASS_HUE = 190 // 未分類はシアン寄り
const MAX_ZOOM = 2.4 // 初期フィットの拡大率上限（少数ノードで拡大しすぎるのを防ぐ）
const MIN_ZOOM = 0.05 // 初期フィットの縮小率下限
const LINK_CURVATURE = 0.18 // エッジの湾曲（ラベル配置もこの値に合わせる）

// HSL(彩度85%/明度63%固定) → "rgba(r,g,b,a)"。canvas でのエッジ/粒の色に使う
// （hsla の slash 記法は canvas 実装差があるため rgb に変換して確実に描画する）。
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))]
}
function neon(hue: number, alpha: number): string {
  const [r, g, b] = hslToRgb(hue, 0.85, 0.63)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function linkEndNode(end: string | GraphNode): GraphNode | null {
  return typeof end === "object" ? end : null
}
function linkEndId(end: string | GraphNode): string {
  return typeof end === "object" ? end.id : end
}
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

export default function TripletGraphCanvas({
  triplets,
  instById,
  classNameById,
  width,
  height,
  onSelectNode,
}: {
  triplets: Triplet[]
  instById: Map<string, OntologyInstance>
  classNameById: Map<string, string>
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

    return { data: { nodes: [...nodeMap.values()], links }, adjacency }
  }, [triplets, instById, classNameById])

  // 全ノードが収まる拡大率を自前で算出し、上限(MAX_ZOOM)でクランプして一度だけ滑らかにフィット。
  // zoomToFit は少数ノードで拡大しすぎるため使わない。
  const fitToView = useCallback(
    (duration = 600) => {
      const fg = fgRef.current
      if (!fg || width <= 0 || height <= 0) return false
      let bbox: { x: [number, number]; y: [number, number] } | null = null
      try {
        bbox = fg.getGraphBbox()
      } catch {
        return false
      }
      if (!bbox) return false
      const spanX = bbox.x[1] - bbox.x[0]
      const spanY = bbox.y[1] - bbox.y[0]
      const pad = 80
      const zx = spanX > 0 ? (width - 2 * pad) / spanX : MAX_ZOOM
      const zy = spanY > 0 ? (height - 2 * pad) / spanY : MAX_ZOOM
      const z = Math.max(MIN_ZOOM, Math.min(zx, zy, MAX_ZOOM))
      programmaticRef.current = true
      fg.centerAt((bbox.x[0] + bbox.x[1]) / 2, (bbox.y[0] + bbox.y[1]) / 2, duration)
      fg.zoom(z, duration)
      window.setTimeout(() => { programmaticRef.current = false }, duration + 120)
      return true
    },
    [width, height],
  )

  // データ/サイズ変更でフィット状態をリセット
  useEffect(() => {
    hasFitRef.current = false
    userMovedRef.current = false
  }, [data, width, height])

  // ノードに座標が付くまで待って一度だけフィット（ユーザー操作が入ったら中止）
  useEffect(() => {
    if (width <= 0 || height <= 0) return
    let tries = 0
    const iv = window.setInterval(() => {
      if (hasFitRef.current || userMovedRef.current || tries++ > 40) {
        window.clearInterval(iv)
        return
      }
      if (fitToView(tries <= 1 ? 0 : 600)) {
        hasFitRef.current = true
        window.clearInterval(iv)
      }
    }, 120)
    return () => window.clearInterval(iv)
  }, [data, width, height, fitToView])

  // d3-force のパラメータ調整（反発を強め、程よく広がるレイアウトに）
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    try {
      fg.d3Force("charge")?.strength(-220)
      fg.d3Force("link")?.distance(70)
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

      // ラベル（一定以上ズーム時、またはホバー近傍のみ）
      if (globalScale > 0.55 || (hovering && hi)) {
        const fontSize = Math.max(11 / globalScale, 3)
        ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`
        ctx.textAlign = "center"
        ctx.textBaseline = "top"
        ctx.fillStyle = hi ? "rgba(235,240,255,0.92)" : "rgba(160,170,200,0.4)"
        ctx.fillText(node.name, x, y + node.r + 2)
      }
      ctx.globalAlpha = 1
    },
    [isNodeHi, hoverId, hovering],
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

      const mx = (s.x + t.x) / 2
      const my = (s.y + t.y) / 2
      const dx = t.x - s.x
      const dy = t.y - s.y
      const len = Math.hypot(dx, dy) || 1
      // 曲線(二次ベジェ)の頂点にラベルを載せる（線の真上）
      const lx = mx + (-dy / len) * len * LINK_CURVATURE * 0.5
      const ly = my + (dx / len) * len * LINK_CURVATURE * 0.5

      const label = link.label
      if (!label) return
      const fontSize = Math.max(13 / globalScale, 2)
      ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      const tw = ctx.measureText(label).width
      const padX = 3 / globalScale
      const padY = 1.5 / globalScale
      // 背景（可読性のため半透明の下地）
      ctx.fillStyle = hi ? "rgba(10,11,20,0.85)" : "rgba(10,11,20,0.72)"
      ctx.fillRect(lx - tw / 2 - padX, ly - fontSize / 2 - padY, tw + padX * 2, fontSize + padY * 2)
      ctx.fillStyle = hi ? "rgba(235,240,255,1)" : "rgba(210,218,240,0.9)"
      ctx.fillText(label, lx, ly)
    },
    [isLinkHi, hovering, showEdgeLabels],
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
    // ドロップ位置に固定（配置を保持）
    node.fx = node.x
    node.fy = node.y
  }, [])

  return (
    <div className="relative" style={{ width, height }}>
      <button
        type="button"
        onClick={() => setShowEdgeLabels((v) => !v)}
        className="absolute right-3 top-3 z-10 rounded-md border border-white/15 bg-black/50 px-2.5 py-1 text-xs text-zinc-200 backdrop-blur-sm transition-colors hover:bg-black/70"
      >
        エッジ名: {showEdgeLabels ? "ON" : "OFF"}
      </button>
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
      linkLabel={((l: GraphLink) => `<div class="gv-tt-name">${esc(l.label)}</div><div class="gv-tt-sub">${esc(linkEndNode(l.source)?.name ?? "")} → ${esc(linkEndNode(l.target)?.name ?? "")}</div>`) as any}
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
        // ユーザーがズーム/パンしたら自動フィットを止める（勝手に戻さない）
        if (!programmaticRef.current) userMovedRef.current = true
      }) as any}
      warmupTicks={60}
      cooldownTime={2000}
      />
    </div>
  )
}
