"use client"

// トリプレットのマインドマップ描画本体（クライアント専用）。
//   react-force-graph-2d を top-level import するため、SSR を避ける目的で
//   triplet-graph.tsx から next/dynamic({ ssr:false }) 経由でのみ読み込む。
//
//   配置は力学任せにしない。中心に根を置き、子を左右に振り分けて横方向の
//   ツリーに並べる（lib/mindmap-layout.ts）。力学だと1つのノードに子が
//   何十個もぶら下がった時点で全員が同じ半径に押し込まれ、名前が重なって
//   読めなくなるため。子が40個なら縦に40行並ぶだけになる。
//
//   ノード=インスタンス（クラス色のカード）、エッジ=述語。
//   木の枝はなめらかな曲線、木に入らない繋がりは点線で描く。

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import ForceGraph2D from "react-force-graph-2d"
import type { Triplet, OntologyInstance, RelationCondition } from "@/lib/types"
import { formatRelationCondition } from "@/lib/relation-conditions"
import { hueForClass, NO_CLASS_HUE, neon, esc } from "@/lib/graph-colors"
import { mindMapLayout } from "@/lib/mindmap-layout"

type GraphNode = {
  id: string
  name: string
  // カードに収まるよう必要なら末尾を詰めた表示用の文字列
  label: string
  classId: string | null
  className: string
  hue: number
  w: number
  h: number
  depth: number
  side: -1 | 0 | 1
  parentId: string | null
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
  // 木の枝（親子）か。false なら横の繋がりとして点線で描く。
  isTree: boolean
}

const MAX_ZOOM = 1.6 // 初期フィットの拡大率上限（少数ノードで拡大しすぎるのを防ぐ）
const MIN_ZOOM = 0.05 // 初期フィットの縮小率下限
const CARD_FONT = 13 // カードの文字の大きさ（グラフ座標）
const CARD_H = 30 // カードの高さ
const CARD_PAD_X = 13 // カードの左右の余白
const CARD_MAX_W = 260 // カードの最大幅（超える名前は末尾を詰める）
const CARD_MIN_W = 56
const FONT_FAMILY = "ui-sans-serif, system-ui, sans-serif"

type LabelRect = { x0: number; y0: number; x1: number; y1: number }

function linkEndNode(end: string | GraphNode): GraphNode | null {
  return typeof end === "object" ? end : null
}
function linkEndId(end: string | GraphNode): string {
  return typeof end === "object" ? end.id : end
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rad, y)
  ctx.lineTo(x + w - rad, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad)
  ctx.lineTo(x + w, y + h - rad)
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h)
  ctx.lineTo(x + rad, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad)
  ctx.lineTo(x, y + rad)
  ctx.quadraticCurveTo(x, y, x + rad, y)
  ctx.closePath()
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
  // エッジを流れる光の粒。常に動いていると目が疲れるので既定は止めておく。
  const [animate, setAnimate] = useState(false)
  const hasFitRef = useRef(false) // 初期フィット済みか
  const userMovedRef = useRef(false) // ユーザーがズーム/パンしたか（以後は自動フィットしない）
  const programmaticRef = useRef(false) // 自分でズームした瞬間か（onZoom を無視するため）

  // カードの幅を測るための隠しコンテキスト（描画前に実寸が要る）
  const measure = useMemo(() => {
    if (typeof document === "undefined") return (text: string) => text.length * CARD_FONT * 0.6
    const ctx = document.createElement("canvas").getContext("2d")
    if (!ctx) return (text: string) => text.length * CARD_FONT * 0.6
    ctx.font = `${CARD_FONT}px ${FONT_FAMILY}`
    return (text: string) => ctx.measureText(text).width
  }, [])

  // triplets → {nodes, links} + 隣接情報。配置もここで決めて固定する。
  const { data, adjacency } = useMemo(() => {
    const nodeMap = new Map<string, GraphNode>()
    const adjacency = new Map<string, Set<string>>()
    const inner = CARD_MAX_W - CARD_PAD_X * 2

    const touch = (id: string, name: string, classId: string | null) => {
      if (nodeMap.has(id)) return
      const inst = instById.get(id)
      const cid = inst?.classId ?? classId
      const cls = cid ? classNameById.get(cid) : undefined
      const full = inst?.name ?? name
      // 収まらない名前は末尾を詰める（カードからはみ出させない）
      let label = full
      if (measure(full) > inner) {
        let lo = 1
        let hi = full.length
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2)
          if (measure(`${full.slice(0, mid)}…`) <= inner) lo = mid
          else hi = mid - 1
        }
        label = `${full.slice(0, lo)}…`
      }
      nodeMap.set(id, {
        id,
        name: full,
        label,
        classId: cid,
        className: cls ?? "未分類",
        hue: cid ? hueForClass(cid) : NO_CLASS_HUE,
        w: Math.max(CARD_MIN_W, measure(label) + CARD_PAD_X * 2),
        h: CARD_H,
        depth: 0,
        side: 0,
        parentId: null,
      })
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
        isTree: false,
      })
      if (!adjacency.has(t.subjectInstanceId)) adjacency.set(t.subjectInstanceId, new Set())
      if (!adjacency.has(t.objectInstanceId)) adjacency.set(t.objectInstanceId, new Set())
      adjacency.get(t.subjectInstanceId)!.add(t.objectInstanceId)
      adjacency.get(t.objectInstanceId)!.add(t.subjectInstanceId)
    }

    const nodes = [...nodeMap.values()]
    const placement = mindMapLayout(
      nodes.map((n) => ({ id: n.id, w: n.w, h: n.h })),
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
      n.side = p.side
      n.parentId = p.parentId
    }
    // 親子にあたる辺だけを木の枝として扱う（残りは横の繋がり＝点線）
    for (const l of links) {
      const s = linkEndId(l.source)
      const t = linkEndId(l.target)
      l.isTree = placement.get(t)?.parentId === s || placement.get(s)?.parentId === t
    }

    return { data: { nodes, links }, adjacency }
  }, [triplets, instById, classNameById, measure])

  // 全ノードが収まる拡大率を自前で算出し、上限(MAX_ZOOM)でクランプしてフィット。
  // 位置は自分で決めているので、描画側(getGraphBbox)を待たずに範囲を出せる。
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
        x0 = Math.min(x0, n.x - n.w / 2)
        x1 = Math.max(x1, n.x + n.w / 2)
        y0 = Math.min(y0, n.y - n.h / 2)
        y1 = Math.max(y1, n.y + n.h / 2)
      }
      const pad = 60
      const zx = x1 > x0 ? (width - 2 * pad) / (x1 - x0) : MAX_ZOOM
      const zy = y1 > y0 ? (height - 2 * pad) / (y1 - y0) : MAX_ZOOM
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

  // 一度だけ全体を収める。描画の初期化前に呼ぶと効かないことがあるので少しの間やり直す。
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

  // 位置はレイアウトで決めているので力学は全て外す
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

  // エッジ名の重なり防止。1フレームごとに場所を取り合い、先に取った方だけが描かれる。
  const labelRectsRef = useRef<LabelRect[]>([])
  const claimRect = useCallback((rect: LabelRect) => {
    for (const r of labelRectsRef.current) {
      if (rect.x0 < r.x1 && rect.x1 > r.x0 && rect.y0 < r.y1 && rect.y1 > r.y0) return false
    }
    labelRectsRef.current.push(rect)
    return true
  }, [])
  // 描画の最初に、カードの場所を先に押さえる。エッジ名はカードに重ならない場所にだけ出る。
  const handleRenderPre = useCallback(() => {
    labelRectsRef.current = data.nodes.map((n) => ({
      x0: (n.x ?? 0) - n.w / 2,
      y0: (n.y ?? 0) - n.h / 2,
      x1: (n.x ?? 0) + n.w / 2,
      y1: (n.y ?? 0) + n.h / 2,
    }))
  }, [data])

  const paintNode = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D) => {
      const x = node.x ?? 0
      const y = node.y ?? 0
      const hi = isNodeHi(node.id)
      const isRoot = node.depth === 0
      ctx.globalAlpha = hi ? 1 : 0.18

      const x0 = x - node.w / 2
      const y0 = y - node.h / 2
      // 根は中心らしく濃い色、枝はクラス色のカード（添付のマインドマップに合わせる）
      const fill = isRoot ? "#1d2742" : `hsl(${node.hue}, 68%, 58%)`
      const stroke = isRoot ? `hsl(${node.hue}, 80%, 62%)` : `hsl(${node.hue}, 80%, 72%)`
      ctx.shadowColor = `hsl(${node.hue}, 85%, 60%)`
      ctx.shadowBlur = node.id === hoverId ? 18 : hi ? 8 : 0
      roundRect(ctx, x0, y0, node.w, node.h, node.h / 2)
      ctx.fillStyle = fill
      ctx.fill()
      ctx.shadowBlur = 0
      ctx.lineWidth = node.id === hoverId ? 2 : 1
      ctx.strokeStyle = stroke
      ctx.stroke()

      ctx.font = `${isRoot ? 600 : 500} ${CARD_FONT}px ${FONT_FAMILY}`
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillStyle = isRoot ? "rgba(235,240,255,0.96)" : "rgba(12,14,26,0.92)"
      ctx.fillText(node.label, x, y + 0.5)
      ctx.globalAlpha = 1
    },
    [isNodeHi, hoverId],
  )

  const paintNodePointerArea = useCallback(
    (node: GraphNode, color: string, ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = color
      roundRect(ctx, (node.x ?? 0) - node.w / 2, (node.y ?? 0) - node.h / 2, node.w, node.h, node.h / 2)
      ctx.fill()
    },
    [],
  )

  // 枝の曲線。親のカードの横から出て、子のカードの横へ入る。
  const branchPath = (parent: GraphNode, child: GraphNode) => {
    const dir: 1 | -1 = child.side === -1 ? -1 : 1
    const px = (parent.x ?? 0) + (dir * parent.w) / 2
    const py = parent.y ?? 0
    const cx = (child.x ?? 0) - (dir * child.w) / 2
    const cy = child.y ?? 0
    const reach = Math.abs(cx - px) * 0.5
    return { px, py, cx, cy, c1x: px + dir * reach, c2x: cx - dir * reach }
  }

  const paintLink = useCallback(
    (link: GraphLink, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const s = linkEndNode(link.source)
      const t = linkEndNode(link.target)
      if (!s || !t || s.x == null || s.y == null || t.x == null || t.y == null) return
      const hi = isLinkHi(link)
      const hue = link.isTree ? (t.parentId === s.id ? t.hue : s.hue) : s.hue
      ctx.globalAlpha = 1
      ctx.strokeStyle = !hovering ? neon(hue, 0.55) : hi ? neon(hue, 0.95) : "rgba(120,130,180,0.06)"
      ctx.lineWidth = (hi ? 2 : 1.4) / Math.max(globalScale, 0.35)

      let mx: number
      let my: number
      if (link.isTree) {
        const parent = t.parentId === s.id ? s : t
        const child = parent === s ? t : s
        const { px, py, cx, cy, c1x, c2x } = branchPath(parent, child)
        ctx.setLineDash([])
        ctx.beginPath()
        ctx.moveTo(px, py)
        ctx.bezierCurveTo(c1x, py, c2x, cy, cx, cy)
        ctx.stroke()
        // 三次ベジェの中点
        mx = (px + 3 * c1x + 3 * c2x + cx) / 8
        my = (py + 3 * py + 3 * cy + cy) / 8
      } else {
        // 木に入らなかった繋がりは点線（添付の "Connection" と同じ扱い）
        const dash = 4 / Math.max(globalScale, 0.35)
        ctx.setLineDash([dash, dash * 1.6])
        ctx.beginPath()
        ctx.moveTo(s.x, s.y)
        ctx.quadraticCurveTo((s.x + t.x) / 2, (s.y + t.y) / 2 - Math.abs(t.x - s.x) * 0.12, t.x, t.y)
        ctx.stroke()
        ctx.setLineDash([])
        mx = (s.x + t.x) / 2
        my = (s.y + t.y) / 2 - Math.abs(t.x - s.x) * 0.06
      }

      if (!showEdgeLabels || !link.label) return
      if (hovering && !hi) return
      const fontSize = Math.max(12 / globalScale, 2)
      ctx.font = `${fontSize}px ${FONT_FAMILY}`
      const tw = ctx.measureText(link.label).width
      const padX = 4 / globalScale
      const padY = 2 / globalScale
      const rect = {
        x0: mx - tw / 2 - padX,
        y0: my - fontSize / 2 - padY,
        x1: mx + tw / 2 + padX,
        y1: my + fontSize / 2 + padY,
      }
      // 席が空いていなければ出さない（重ねて読めなくするより間引く）。
      // ホバーで名指しした1本だけは、重なっていても必ず出す。
      const gap = 6 / globalScale
      if (
        hoverLinkId !== link.id &&
        !claimRect({ x0: rect.x0 - gap, y0: rect.y0 - gap, x1: rect.x1 + gap, y1: rect.y1 + gap })
      )
        return
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillStyle = hi ? "rgba(10,11,20,0.9)" : "rgba(10,11,20,0.78)"
      ctx.fillRect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0)
      ctx.fillStyle = hi ? "rgba(235,240,255,1)" : "rgba(205,214,240,0.9)"
      ctx.fillText(link.label, mx, my)
    },
    [isLinkHi, hovering, showEdgeLabels, claimRect, hoverLinkId],
  )

  const paintLinkPointerArea = useCallback(
    (link: GraphLink, color: string, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const s = linkEndNode(link.source)
      const t = linkEndNode(link.target)
      if (!s || !t || s.x == null || s.y == null || t.x == null || t.y == null) return
      ctx.strokeStyle = color
      ctx.lineWidth = 8 / Math.max(globalScale, 0.35)
      ctx.setLineDash([])
      ctx.beginPath()
      if (link.isTree) {
        const parent = t.parentId === s.id ? s : t
        const child = parent === s ? t : s
        const { px, py, cx, cy, c1x, c2x } = branchPath(parent, child)
        ctx.moveTo(px, py)
        ctx.bezierCurveTo(c1x, py, c2x, cy, cx, cy)
      } else {
        ctx.moveTo(s.x, s.y)
        ctx.lineTo(t.x, t.y)
      }
      ctx.stroke()
    },
    [],
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
    // ドロップ位置に固定（並びから動かしたぶんはそのまま残す）
    node.fx = node.x
    node.fy = node.y
  }, [])

  const toggleClass =
    "rounded-md border border-white/15 bg-black/50 px-2.5 py-1 text-xs text-zinc-200 backdrop-blur-sm transition-colors hover:bg-black/70"

  return (
    <div className="relative" style={{ width, height }}>
      <div className="absolute right-3 top-3 z-10 flex gap-1.5">
        <button type="button" className={toggleClass} onClick={() => { userMovedRef.current = false; fitToView(500) }}>
          全体表示
        </button>
        <button type="button" className={toggleClass} onClick={() => setShowEdgeLabels((v) => !v)}>
          エッジ名: {showEdgeLabels ? "ON" : "OFF"}
        </button>
        <button type="button" className={toggleClass} onClick={() => setAnimate((v) => !v)}>
          アニメーション: {animate ? "ON" : "OFF"}
        </button>
      </div>
      <ForceGraph2D
      ref={fgRef}
      width={width}
      height={height}
      graphData={data}
      backgroundColor="#0a0b14"
      nodeRelSize={1}
      nodeVal={((n: GraphNode) => n.w * n.h) as any}
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
      linkCanvasObjectMode={(() => "replace") as any}
      linkCanvasObject={paintLink as any}
      linkPointerAreaPaint={paintLinkPointerArea as any}
      linkDirectionalParticles={((l: GraphLink) => (animate && (!hovering || isLinkHi(l)) ? 2 : 0)) as any}
      linkDirectionalParticleWidth={2.4}
      linkDirectionalParticleSpeed={0.006}
      linkDirectionalParticleColor={((l: GraphLink) => neon(linkEndNode(l.target)?.hue ?? 210, 0.95)) as any}
      onRenderFramePre={handleRenderPre as any}
      onNodeHover={(n: GraphNode | null) => setHoverId(n?.id ?? null)}
      onLinkHover={((l: GraphLink | null) => setHoverLinkId(l?.id ?? null)) as any}
      onNodeClick={handleNodeClick as any}
      onNodeDragEnd={handleNodeDragEnd as any}
      onZoom={(() => {
        // ユーザーがズーム/パンしたら自動フィットを止める（勝手に戻さない）。
        // 初期化のときにも1度発火するので、最初のフィットが済むまでは数えない。
        if (!programmaticRef.current && hasFitRef.current) userMovedRef.current = true
      }) as any}
      warmupTicks={0}
      cooldownTicks={0}
      />
    </div>
  )
}
