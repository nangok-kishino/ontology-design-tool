"use client"

// トリプレットのグラフ描画本体（クライアント専用）。
//   react-force-graph-2d を top-level import するため、SSR を避ける目的で
//   triplet-graph.tsx から next/dynamic({ ssr:false }) 経由でのみ読み込む。
//
//   配置は力学任せにしない。列はクラスの括り（ルートクラス）で決めて
//   左から右へ流す（lib/graph-layout.ts）。同じ親を持つクラス――支柱・ビーム・
//   板のように部品図面の下にあるもの――は同じ列に入る。
//
//   ノード = インスタンス、またはクラスそのもの。カードは上段が種別（クラス名／
//   「クラス」）、下段が名前。クラスのカードは縁を点線にして一目で分かるようにする。
//   色は「どのクラスか」を示すためだけに使い、塗りは暗いまま縁と見出しに効かせる。
//   エッジの色はリレーション定義ごと。

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import ForceGraph2D from "react-force-graph-2d"
import type { RelationCondition } from "@/lib/types"
import { endKey, type GraphEdge } from "@/lib/graph-edges"
import { formatRelationCondition } from "@/lib/relation-conditions"
import { NO_CLASS_HUE, cardAccent, cardBorder, cardFill, line, esc } from "@/lib/graph-colors"
import { layeredLayout } from "@/lib/graph-layout"

type GraphNode = {
  id: string
  // クラスそのものか、インスタンスか
  kind: "class" | "instance"
  name: string
  // カードに収まるよう必要なら末尾を詰めた表示用の文字列
  label: string
  classId: string | null
  // 列を決める括り（ルートクラス）
  groupId: string
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

const MAX_ZOOM = 1.5 // 初期フィットの拡大率上限（少数ノードで拡大しすぎるのを防ぐ）
const MIN_ZOOM = 0.05 // 初期フィットの縮小率下限
const NAME_FONT = 13 // カードの名前の大きさ（グラフ座標）
const CLASS_FONT = 10 // カードのクラス名の大きさ
const CARD_H = 42 // カードの高さ（2段ぶん）
const CARD_R = 9 // カードの角の丸み
const CARD_PAD_X = 14 // カードの左右の余白
const CARD_MAX_W = 250 // カードの最大幅（超える名前は末尾を詰める）
const CARD_MIN_W = 70
const BG = "#0b0d13"
const TEXT = "rgba(228,233,243,0.95)"
const FONT_FAMILY = "ui-sans-serif, system-ui, sans-serif"
const PARTICLE_PERIOD = 2400 // 粒が線を1周する時間(ms)

type LabelRect = { x0: number; y0: number; x1: number; y1: number }
type EdgePath = { forward: boolean; px: number; py: number; cx: number; cy: number; c1x: number; c2x: number }

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

// 描いている曲線そのものの座標（粒を線の上に乗せるのに使う）
function bezierAt(p: EdgePath, t: number) {
  const u = 1 - t
  const x = u * u * u * p.px + 3 * u * u * t * p.c1x + 3 * u * t * t * p.c2x + t * t * t * p.cx
  const y = u * u * u * p.py + 3 * u * u * t * p.py + 3 * u * t * t * p.cy + t * t * t * p.cy
  return { x, y }
}

export default function TripletGraphCanvas({
  edges,
  classNameById,
  attrNameById,
  conditionsByRelationId,
  hueByClassId,
  hueByRelationId,
  rootClassIdById,
  width,
  height,
  onSelectNode,
}: {
  // インスタンス同士・クラスを含む、どちらのトリプレットも同じ形で受け取る
  edges: GraphEdge[]
  classNameById: Map<string, string>
  attrNameById?: Map<string, string>
  conditionsByRelationId?: Map<string, RelationCondition[]>
  // クラス／リレーションごとの色。一覧の並び順で配ってあるので、
  // 同じクラスのインスタンス・同じリレーションのエッジは必ず同じ色になる。
  hueByClassId?: Map<string, number>
  hueByRelationId?: Map<string, number>
  // クラスid → そのルートクラスid（列の括りに使う）
  rootClassIdById?: Map<string, string>
  width: number
  height: number
  onSelectNode?: (instanceId: string) => void
}) {
  const fgRef = useRef<any>(undefined)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [hoverLinkId, setHoverLinkId] = useState<string | null>(null)
  const [showEdgeLabels, setShowEdgeLabels] = useState(false)
  // エッジを流れる粒。常に動いていると目が疲れるので既定は止めておく。
  const [animate, setAnimate] = useState(false)
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

  // edges → {nodes, links} + 隣接情報。配置もここで決めて固定する。
  const { data, adjacency } = useMemo(() => {
    const nodeMap = new Map<string, GraphNode>()
    const adjacency = new Map<string, Set<string>>()
    const inner = CARD_MAX_W - CARD_PAD_X * 2

    const touch = (end: GraphEdge["source"]) => {
      const id = endKey(end)
      if (nodeMap.has(id)) return id
      const cid = end.classId
      // 上段はインスタンスなら所属クラス名、クラスそのものなら「クラス」
      const kindLabel = end.kind === "class" ? "クラス" : ((cid ? classNameById.get(cid) : undefined) ?? "未分類")
      const label = fitText(end.name, NAME_FONT, inner)
      const classLabel = fitText(kindLabel, CLASS_FONT, inner)
      nodeMap.set(id, {
        id,
        kind: end.kind,
        name: end.name,
        label,
        classId: cid,
        groupId: (cid ? rootClassIdById?.get(cid) : undefined) ?? cid ?? "",
        className: kindLabel,
        classLabel,
        hue: (cid ? hueByClassId?.get(cid) : undefined) ?? NO_CLASS_HUE,
        w: Math.max(CARD_MIN_W, Math.max(measure(label, NAME_FONT), measure(classLabel, CLASS_FONT)) + CARD_PAD_X * 2),
        h: CARD_H,
        layer: 0,
      })
      return id
    }

    const links: GraphLink[] = []
    for (const e of edges) {
      const sid = touch(e.source)
      const tid = touch(e.target)
      if (sid === tid) continue
      links.push({
        id: e.id,
        source: sid,
        target: tid,
        label: e.predicateName,
        predicateRelationId: e.predicateRelationId,
        attributes: e.attributes,
        hue: hueByRelationId?.get(e.predicateRelationId) ?? 210,
      })
      if (!adjacency.has(sid)) adjacency.set(sid, new Set())
      if (!adjacency.has(tid)) adjacency.set(tid, new Set())
      adjacency.get(sid)!.add(tid)
      adjacency.get(tid)!.add(sid)
    }

    // クラス一覧の並び順で渡す（列の中はその順にクラスが並ぶ）。
    // 同じクラスの中では、クラスそのもののカードを先頭に置く。
    const classRank = new Map([...(hueByClassId?.keys() ?? [])].map((id, i) => [id, i]))
    const nodes = [...nodeMap.values()].sort(
      (a, b) =>
        (classRank.get(a.classId ?? "") ?? Number.MAX_SAFE_INTEGER) -
          (classRank.get(b.classId ?? "") ?? Number.MAX_SAFE_INTEGER) ||
        (a.kind === b.kind ? 0 : a.kind === "class" ? -1 : 1) ||
        a.name.localeCompare(b.name),
    )
    const placement = layeredLayout(
      nodes.map((n) => ({ id: n.id, w: n.w, h: n.h, classId: n.classId, groupId: n.groupId })),
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

    return { data: { nodes, links }, adjacency }
  }, [edges, classNameById, hueByClassId, hueByRelationId, rootClassIdById, measure, fitText])

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
      const pad = 56
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
      const focused = node.id === hoverId
      ctx.globalAlpha = hi ? 1 : 0.22

      const x0 = x - node.w / 2
      const y0 = y - node.h / 2
      roundRect(ctx, x0, y0, node.w, node.h, CARD_R)
      ctx.fillStyle = cardFill(node.hue)
      ctx.fill()
      ctx.lineWidth = focused ? 1.6 : 1
      ctx.strokeStyle = cardBorder(node.hue, focused)
      // クラスそのもののカードは縁を破線に（個々のものではなく「種類」を表すため）
      ctx.setLineDash(node.kind === "class" ? [4, 3] : [])
      ctx.stroke()
      ctx.setLineDash([])

      ctx.textAlign = "left"
      ctx.textBaseline = "middle"
      // 上段：クラス名（何の種類か）、下段：インスタンス名
      ctx.font = `${CLASS_FONT}px ${FONT_FAMILY}`
      ctx.fillStyle = cardAccent(node.hue)
      ctx.fillText(node.classLabel, x0 + CARD_PAD_X, y0 + 13)
      ctx.font = `500 ${NAME_FONT}px ${FONT_FAMILY}`
      ctx.fillStyle = TEXT
      ctx.fillText(node.label, x0 + CARD_PAD_X, y0 + CARD_H - 15)
      ctx.globalAlpha = 1
    },
    [isNodeHi, hoverId],
  )

  const paintNodePointerArea = useCallback(
    (node: GraphNode, color: string, ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = color
      roundRect(ctx, (node.x ?? 0) - node.w / 2, (node.y ?? 0) - node.h / 2, node.w, node.h, CARD_R)
      ctx.fill()
    },
    [],
  )

  // つながりの曲線。左の列のカードの右端から出て、右の列のカードの左端へ入る。
  // 同じ列の中の関係（部品どうしの構成など）は、列の右側にふくらませて戻す。
  const edgePath = (link: GraphLink): EdgePath | null => {
    const s = linkEndNode(link.source)
    const t = linkEndNode(link.target)
    if (!s || !t || s.x == null || s.y == null || t.x == null || t.y == null) return null
    if (s.layer === t.layer) {
      const px = s.x + s.w / 2
      const py = s.y
      const cx = t.x + t.w / 2
      const cy = t.y
      const bow = 30 + Math.abs(cy - py) * 0.18
      return { forward: false, px, py, cx, cy, c1x: px + bow, c2x: cx + bow }
    }
    const from = t.layer > s.layer ? s : t
    const to = t.layer > s.layer ? t : s
    const px = (from.x ?? 0) + from.w / 2
    const py = from.y ?? 0
    const cx = (to.x ?? 0) - to.w / 2
    const cy = to.y ?? 0
    const reach = Math.max(24, Math.abs(cx - px) * 0.5)
    return { forward: true, px, py, cx, cy, c1x: px + reach, c2x: cx - reach }
  }

  const paintLink = useCallback(
    (link: GraphLink, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const path = edgePath(link)
      if (!path) return
      const hi = isLinkHi(link)
      ctx.globalAlpha = 1
      ctx.strokeStyle = !hovering ? line(link.hue, 0.5) : hi ? line(link.hue, 0.95) : "rgba(130,140,170,0.05)"
      ctx.lineWidth = (hi ? 1.8 : 1.2) / Math.max(globalScale, 0.35)
      const dash = 5 / Math.max(globalScale, 0.35)
      ctx.setLineDash(path.forward ? [] : [dash, dash * 1.4])
      ctx.beginPath()
      ctx.moveTo(path.px, path.py)
      ctx.bezierCurveTo(path.c1x, path.py, path.c2x, path.cy, path.cx, path.cy)
      ctx.stroke()
      ctx.setLineDash([])

      // 粒は描いた曲線の上をそのまま流す（ライブラリの粒は自前の曲線を知らないので使わない）
      if (animate && (!hovering || hi)) {
        const base = (performance.now() % PARTICLE_PERIOD) / PARTICLE_PERIOD
        ctx.fillStyle = line(link.hue, 0.95)
        for (let k = 0; k < 2; k++) {
          const pt = bezierAt(path, (base + k / 2) % 1)
          ctx.beginPath()
          ctx.arc(pt.x, pt.y, 2.2 / Math.max(globalScale, 0.35), 0, 2 * Math.PI)
          ctx.fill()
        }
      }

      if (!showEdgeLabels || !link.label) return
      if (hovering && !hi) return
      const mx = (path.px + 3 * path.c1x + 3 * path.c2x + path.cx) / 8
      const my = (path.py + 3 * path.py + 3 * path.cy + path.cy) / 8
      const fontSize = Math.max(11 / globalScale, 2)
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
      ctx.fillStyle = "rgba(11,13,19,0.85)"
      ctx.fillRect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0)
      ctx.fillStyle = line(link.hue, 1)
      ctx.fillText(link.label, mx, my)
    },
    [isLinkHi, hovering, showEdgeLabels, claimRect, hoverLinkId, animate],
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
      onSelectNode?.(node.id.slice(node.id.indexOf(":") + 1))
    },
    [onSelectNode],
  )

  const handleNodeDragEnd = useCallback((node: GraphNode) => {
    userMovedRef.current = true // 以後は自動フィットしない
    node.fx = node.x
    node.fy = node.y
  }, [])

  const toggleClass =
    "rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-300 backdrop-blur-sm transition-colors hover:bg-white/10"

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
      backgroundColor={BG}
      nodeRelSize={1}
      nodeVal={((n: GraphNode) => n.w * n.h) as any}
      nodeCanvasObject={paintNode as any}
      nodePointerAreaPaint={paintNodePointerArea as any}
      nodeLabel={((n: GraphNode) =>
        `<div class="gv-tt-name">${esc(n.name)}</div>` +
        `<div class="gv-tt-sub">${esc(n.kind === "class" ? "クラス" : n.className)}</div>`) as any}
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
      // 既定では静止したときに再描画が止まる。粒を流す間だけ止めさせない。
      autoPauseRedraw={!animate}
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
