"use client"

// トリプレットのグラフ描画本体（クライアント専用）。
//   react-force-graph-2d を top-level import するため、SSR を避ける目的で
//   triplet-graph.tsx から next/dynamic({ ssr:false }) 経由でのみ読み込む。
//
//   配置は力学任せにしない。関係の向きで段を決めて左から右へ流す
//   （lib/graph-layout.ts）。力学だと1つのノードに子が何十個もぶら下がった
//   時点で全員が同じ半径に押し込まれ、名前が重なって読めなくなるうえ、
//   どの関係でつながっているのかも見て取れない。
//
//   ノード = インスタンス。カードにはクラス名と名前を2段で出し、
//   色はクラスごとに揃える（同じクラスなら同じ色）。
//   エッジ = トリプレット。色はリレーション定義ごとに揃える。
//   色の対応は凡例で示す。

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import ForceGraph2D from "react-force-graph-2d"
import type { Triplet, OntologyInstance, RelationCondition } from "@/lib/types"
import { formatRelationCondition } from "@/lib/relation-conditions"
import { NO_CLASS_HUE, neon, esc } from "@/lib/graph-colors"
import { layeredLayout } from "@/lib/graph-layout"

type GraphNode = {
  id: string
  name: string
  // カードに収まるよう必要なら末尾を詰めた表示用の文字列
  label: string
  classId: string | null
  className: string
  classLabel: string
  hue: number
  w: number
  h: number
  layer: number
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
  hue: number
}

const MAX_ZOOM = 1.6 // 初期フィットの拡大率上限（少数ノードで拡大しすぎるのを防ぐ）
const MIN_ZOOM = 0.05 // 初期フィットの縮小率下限
const NAME_FONT = 13 // カードの名前の大きさ（グラフ座標）
const CLASS_FONT = 10 // カードのクラス名の大きさ
const CARD_H = 40 // カードの高さ（2段ぶん）
const CARD_PAD_X = 13 // カードの左右の余白
const CARD_MAX_W = 260 // カードの最大幅（超える名前は末尾を詰める）
const CARD_MIN_W = 64
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
  hueByClassId,
  hueByRelationId,
  relationNameById,
  width,
  height,
  onSelectNode,
}: {
  triplets: Triplet[]
  instById: Map<string, OntologyInstance>
  classNameById: Map<string, string>
  attrNameById?: Map<string, string>
  conditionsByRelationId?: Map<string, RelationCondition[]>
  // クラス／リレーションごとの色。一覧の並び順で配ってあるので、
  // 同じクラスのインスタンス・同じリレーションのエッジは必ず同じ色になる。
  hueByClassId?: Map<string, number>
  hueByRelationId?: Map<string, number>
  relationNameById?: Map<string, string>
  width: number
  height: number
  onSelectNode?: (instanceId: string) => void
}) {
  const fgRef = useRef<any>(undefined)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [hoverLinkId, setHoverLinkId] = useState<string | null>(null)
  const [showEdgeLabels, setShowEdgeLabels] = useState(false)
  // エッジを流れる光の粒。常に動いていると目が疲れるので既定は止めておく。
  const [animate, setAnimate] = useState(false)
  const [showLegend, setShowLegend] = useState(true)
  const hasFitRef = useRef(false) // 初期フィット済みか
  const userMovedRef = useRef(false) // ユーザーがズーム/パンしたか（以後は自動フィットしない）
  const programmaticRef = useRef(false) // 自分でズームした瞬間か（onZoom を無視するため）

  // カードの幅を測るための隠しコンテキスト（描画前に実寸が要る）
  const measure = useMemo(() => {
    const ctx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null
    return (text: string, font: number) => {
      if (!ctx) return text.length * font * 0.6
      ctx.font = `${font}px ${FONT_FAMILY}`
      return ctx.measureText(text).width
    }
  }, [])

  // 長い文字列をカードの幅に収まるところまで詰める
  const fitText = useCallback(
    (text: string, font: number, max: number) => {
      if (measure(text, font) <= max) return text
      let lo = 1
      let hi = text.length
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        if (measure(`${text.slice(0, mid)}…`, font) <= max) lo = mid
        else hi = mid - 1
      }
      return `${text.slice(0, lo)}…`
    },
    [measure],
  )

  // triplets → {nodes, links} + 隣接情報。配置もここで決めて固定する。
  const { data, adjacency, legend } = useMemo(() => {
    const nodeMap = new Map<string, GraphNode>()
    const adjacency = new Map<string, Set<string>>()
    const inner = CARD_MAX_W - CARD_PAD_X * 2

    const touch = (id: string, name: string, classId: string | null) => {
      if (nodeMap.has(id)) return
      const inst = instById.get(id)
      const cid = inst?.classId ?? classId
      const className = (cid ? classNameById.get(cid) : undefined) ?? "未分類"
      const full = inst?.name ?? name
      const label = fitText(full, NAME_FONT, inner)
      const classLabel = fitText(className, CLASS_FONT, inner)
      nodeMap.set(id, {
        id,
        name: full,
        label,
        classId: cid,
        className,
        classLabel,
        hue: (cid ? hueByClassId?.get(cid) : undefined) ?? NO_CLASS_HUE,
        w: Math.max(CARD_MIN_W, Math.max(measure(label, NAME_FONT), measure(classLabel, CLASS_FONT)) + CARD_PAD_X * 2),
        h: CARD_H,
        layer: 0,
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
        hue: hueByRelationId?.get(t.predicateRelationId) ?? 210,
      })
      if (!adjacency.has(t.subjectInstanceId)) adjacency.set(t.subjectInstanceId, new Set())
      if (!adjacency.has(t.objectInstanceId)) adjacency.set(t.objectInstanceId, new Set())
      adjacency.get(t.subjectInstanceId)!.add(t.objectInstanceId)
      adjacency.get(t.objectInstanceId)!.add(t.subjectInstanceId)
    }

    const nodes = [...nodeMap.values()]
    const placement = layeredLayout(
      nodes.map((n) => ({ id: n.id, w: n.w, h: n.h, classId: n.classId })),
      links.map((l) => ({ source: linkEndId(l.source), target: linkEndId(l.target) })),
    )
    for (const n of nodes) {
      const p = placement.get(n.id)
      if (!p) continue
      n.x = p.x
      n.y = p.y
      n.fx = p.x
      n.fy = p.y
      n.layer = p.layer
    }

    // 凡例：出てきたクラスとリレーションだけを、色つきで並べる
    const classLegend = [...new Map(nodes.map((n) => [n.className, n.hue])).entries()]
    const relLegend = [
      ...new Map(
        links.map((l) => [relationNameById?.get(l.predicateRelationId) ?? l.label, l.hue]),
      ).entries(),
    ]

    return { data: { nodes, links }, adjacency, legend: { classes: classLegend, relations: relLegend } }
  }, [triplets, instById, classNameById, hueByClassId, hueByRelationId, relationNameById, measure, fitText])

  // 全ノードが収まる拡大率を自前で算出し、上限(MAX_ZOOM)でクランプしてフィット。
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

  // エッジ名の重なり防止。カードの場所を先に押さえ、空いている所にだけ出す。
  const labelRectsRef = useRef<LabelRect[]>([])
  const claimRect = useCallback((rect: LabelRect) => {
    for (const r of labelRectsRef.current) {
      if (rect.x0 < r.x1 && rect.x1 > r.x0 && rect.y0 < r.y1 && rect.y1 > r.y0) return false
    }
    labelRectsRef.current.push(rect)
    return true
  }, [])
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
      ctx.globalAlpha = hi ? 1 : 0.18

      const x0 = x - node.w / 2
      const y0 = y - node.h / 2
      ctx.shadowColor = `hsl(${node.hue}, 85%, 60%)`
      ctx.shadowBlur = node.id === hoverId ? 18 : hi ? 7 : 0
      roundRect(ctx, x0, y0, node.w, node.h, node.h / 2)
      ctx.fillStyle = `hsl(${node.hue}, 66%, 60%)`
      ctx.fill()
      ctx.shadowBlur = 0
      ctx.lineWidth = node.id === hoverId ? 2 : 1
      ctx.strokeStyle = `hsl(${node.hue}, 80%, 76%)`
      ctx.stroke()

      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      // 上段：クラス名（何の種類か）、下段：インスタンス名
      ctx.font = `${CLASS_FONT}px ${FONT_FAMILY}`
      ctx.fillStyle = `hsl(${node.hue}, 70%, 22%)`
      ctx.fillText(node.classLabel, x, y - CARD_H / 2 + 11)
      ctx.font = `600 ${NAME_FONT}px ${FONT_FAMILY}`
      ctx.fillStyle = "rgba(10,12,22,0.95)"
      ctx.fillText(node.label, x, y + CARD_H / 2 - 13)
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

  // つながりの曲線。左の段のカードの右端から出て、右の段のカードの左端へ入る。
  const edgePath = (link: GraphLink) => {
    const s = linkEndNode(link.source)
    const t = linkEndNode(link.target)
    if (!s || !t || s.x == null || s.y == null || t.x == null || t.y == null) return null
    // 段が後ろ向き（右から左）や同じ段のときは、構造から外れた繋がりとして点線にする
    const forward = t.layer > s.layer
    const from = forward ? s : t.layer < s.layer ? t : s
    const to = forward ? t : t.layer < s.layer ? s : t
    const px = (from.x ?? 0) + from.w / 2
    const py = from.y ?? 0
    const cx = (to.x ?? 0) - to.w / 2
    const cy = to.y ?? 0
    const reach = Math.max(24, Math.abs(cx - px) * 0.5)
    return { forward: t.layer !== s.layer, px, py, cx, cy, c1x: px + reach, c2x: cx - reach }
  }

  const paintLink = useCallback(
    (link: GraphLink, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const path = edgePath(link)
      if (!path) return
      const hi = isLinkHi(link)
      ctx.globalAlpha = 1
      ctx.strokeStyle = !hovering ? neon(link.hue, 0.75) : hi ? neon(link.hue, 1) : "rgba(120,130,180,0.06)"
      ctx.lineWidth = (hi ? 2.2 : 1.6) / Math.max(globalScale, 0.35)
      const dash = 5 / Math.max(globalScale, 0.35)
      ctx.setLineDash(path.forward ? [] : [dash, dash * 1.4])
      ctx.beginPath()
      ctx.moveTo(path.px, path.py)
      ctx.bezierCurveTo(path.c1x, path.py, path.c2x, path.cy, path.cx, path.cy)
      ctx.stroke()
      ctx.setLineDash([])

      if (!showEdgeLabels || !link.label) return
      if (hovering && !hi) return
      // 三次ベジェの中点
      const mx = (path.px + 3 * path.c1x + 3 * path.c2x + path.cx) / 8
      const my = (path.py + 3 * path.py + 3 * path.cy + path.cy) / 8
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
      const gap = 6 / globalScale
      if (
        hoverLinkId !== link.id &&
        !claimRect({ x0: rect.x0 - gap, y0: rect.y0 - gap, x1: rect.x1 + gap, y1: rect.y1 + gap })
      )
        return
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillStyle = "rgba(10,11,20,0.82)"
      ctx.fillRect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0)
      ctx.fillStyle = neon(link.hue, 1)
      ctx.fillText(link.label, mx, my)
    },
    [isLinkHi, hovering, showEdgeLabels, claimRect, hoverLinkId],
  )

  const paintLinkPointerArea = useCallback(
    (link: GraphLink, color: string, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const path = edgePath(link)
      if (!path) return
      ctx.strokeStyle = color
      ctx.lineWidth = 8 / Math.max(globalScale, 0.35)
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(path.px, path.py)
      ctx.bezierCurveTo(path.c1x, path.py, path.c2x, path.cy, path.cx, path.cy)
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
        <button type="button" className={toggleClass} onClick={() => setShowLegend((v) => !v)}>
          凡例: {showLegend ? "ON" : "OFF"}
        </button>
      </div>

      {/* 凡例：カードの色＝クラス、線の色＝リレーション */}
      {showLegend && (legend.classes.length > 0 || legend.relations.length > 0) && (
        <div className="absolute left-3 top-3 z-10 max-h-[70%] overflow-y-auto rounded-md border border-white/15 bg-black/55 px-3 py-2 text-xs text-zinc-200 backdrop-blur-sm">
          {legend.classes.length > 0 && (
            <div className="mb-2">
              <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-400">クラス（カードの色）</p>
              {legend.classes.map(([name, hue]) => (
                <div key={name} className="flex items-center gap-1.5 py-0.5">
                  <span className="h-2.5 w-4 rounded-sm" style={{ backgroundColor: `hsl(${hue}, 66%, 60%)` }} />
                  <span>{name}</span>
                </div>
              ))}
            </div>
          )}
          {legend.relations.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-400">リレーション（線の色）</p>
              {legend.relations.map(([name, hue]) => (
                <div key={name} className="flex items-center gap-1.5 py-0.5">
                  <span className="h-0.5 w-4 rounded-sm" style={{ backgroundColor: neon(hue, 1) }} />
                  <span>{name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
      linkDirectionalParticleColor={((l: GraphLink) => neon(l.hue, 0.95)) as any}
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
