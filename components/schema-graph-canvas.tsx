"use client"

// スキーマ図の描画本体（クライアント専用）。
//   react-force-graph-2d を top-level import するため、SSR を避ける目的で
//   schema-graph.tsx から next/dynamic({ ssr:false }) 経由でのみ読み込む。
//   グラフビュー(triplet-graph-canvas)と区別できるよう、設計図(ブループリント)調で描く:
//     背景=濃紺＋ドット方眼＋周辺減光、ノード=クラス名/英語名入りの発光する円
//     （つながるエッジが多いクラスほど大きくし、矢印が円周に散らばるようにする）、
//     エッジ=リレーション（始点→終点のクラス色のグラデーション＋矢印、光の粒なし）、
//     継承=点線＋白抜き三角（UML の汎化）。
//   エッジは線・矢印・ラベルとも自前で描く（矢印を円周で止めるため）。

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import ForceGraph2D from "react-force-graph-2d"
import type { OntologyClass, OntologyRelation } from "@/lib/types"
import { formatRelationCondition } from "@/lib/relation-conditions"
import { hueForClass, neon, esc } from "@/lib/graph-colors"

type SchemaNode = {
  id: string
  cls: OntologyClass
  hue: number
  nameW: number // クラス名の描画幅（グラフ座標）
  enW: number // 英語名の描画幅（英語名なしは 0）
  isolated: boolean // リレーションも親子関係もないクラス
  degree: number // つながるエッジの本数（円の大きさに使う）
  x?: number
  y?: number
  fx?: number
  fy?: number
}

type SchemaLink = {
  id: string
  kind: "rel" | "isa" // rel=リレーション、isa=上位クラス（子→親）
  source: string | SchemaNode
  target: string | SchemaNode
  relation?: OntologyRelation
  curvature: number // 同じクラス間に複数本あるとき重ならないよう曲げる量
  loopIndex: number // 自己参照ループの何本目か（ループの大きさに使う）
  labelW: number // リレーション名の描画幅（リンク長をラベルに合わせて伸ばすのに使う）
}

type Pt = { x: number; y: number }
type Rect = { x: number; y: number; w: number; h: number } // x,y は中心
type Geom =
  | { kind: "quad"; p0: Pt; cp: Pt; p2: Pt; dir: Pt }
  | { kind: "loop"; p0: Pt; p1: Pt; p2: Pt; p3: Pt; dir: Pt }

const BG = "#0a1a2f"
const FONT = "ui-sans-serif, system-ui, sans-serif"
const NAME_FONT = 11 // ノード内のクラス名（グラフ座標。ズームに合わせて拡縮）
const EN_FONT = 8.5
const EDGE_FONT = 8.5
const EDGE_EN_FONT = 7
const LINE_GAP = 3
const MIN_R = 22 // 円の最小半径
const NODE_PAD = 9 // 文字と円周の余白
const HUB_GROWTH = 3.5 // エッジ本数の平方根あたりの半径の増分（ハブほど大きく）
const ARROW_LEN = 8
const MAX_ZOOM = 1.8 // 初期フィットの拡大率上限
const MIN_ZOOM = 0.05
const GRID = 24 // 方眼の1マス（グラフ座標）。5マスごとに十字の目印
const GRAVITY_ISOLATED = 0.15 // どこともつながらないクラスを中心へ引き寄せる力
const GRAVITY_LINKED = 0.004 // つながっているクラスへの同じ力（弱くして全体を広げる）
const NODE_MARGIN = 24 // 円同士が近づける最小の隙間
const LABEL_GAP = 3 // エッジラベル同士・クラスの円との最小の隙間
// エッジラベルを置く候補位置（曲線上の位置 0〜1）。中央から順に、空いている所を探す。
const LABEL_POSITIONS = [0.5, 0.4, 0.6, 0.3, 0.7, 0.22, 0.78]

type SavedLayout = Record<string, { x: number; y: number }>
// localStorage が使えない環境向けに、同じタブ内では配置をメモリにも持つ
const layoutCache = new Map<string, SavedLayout>()

function loadLayout(key: string): SavedLayout {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw) return JSON.parse(raw) as SavedLayout
  } catch {
    /* noop */
  }
  return layoutCache.get(key) ?? {}
}
function saveLayout(key: string, layout: SavedLayout) {
  layoutCache.set(key, layout)
  try {
    window.localStorage.setItem(key, JSON.stringify(layout))
  } catch {
    /* noop */
  }
}
function clearLayout(key: string) {
  layoutCache.delete(key)
  try {
    window.localStorage.removeItem(key)
  } catch {
    /* noop */
  }
}

function endNode(end: string | SchemaNode): SchemaNode | null {
  return typeof end === "object" ? end : null
}
function endId(end: string | SchemaNode): string {
  return typeof end === "object" ? end.id : end
}

// 中心 c から点 toward へ向かう半直線と、半径 r の円周との交点
function clipToCircle(c: Pt, toward: Pt, r: number): Pt {
  const dx = toward.x - c.x
  const dy = toward.y - c.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return c
  const t = Math.min(r / len, 1)
  return { x: c.x + dx * t, y: c.y + dy * t }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// エッジラベル（リレーション名＋英語名）の下地の大きさ
function edgeLabelSize(ctx: CanvasRenderingContext2D, name: string, en: string) {
  ctx.font = `${EDGE_FONT}px ${FONT}`
  const nameW = ctx.measureText(name).width
  ctx.font = `${EDGE_EN_FONT}px ${FONT}`
  const enW = en ? ctx.measureText(en).width : 0
  return { w: Math.max(nameW, enW) + 8, h: EDGE_FONT + 5 + (en ? EDGE_EN_FONT + 2 : 0) }
}

// 曲線上の位置 t（0=始点, 1=終点）の座標
function pointAt(g: Geom, t: number): Pt {
  const u = 1 - t
  if (g.kind === "quad") {
    return {
      x: u * u * g.p0.x + 2 * u * t * g.cp.x + t * t * g.p2.x,
      y: u * u * g.p0.y + 2 * u * t * g.cp.y + t * t * g.p2.y,
    }
  }
  return {
    x: u * u * u * g.p0.x + 3 * u * u * t * g.p1.x + 3 * u * t * t * g.p2.x + t * t * t * g.p3.x,
    y: u * u * u * g.p0.y + 3 * u * u * t * g.p1.y + 3 * u * t * t * g.p2.y + t * t * t * g.p3.y,
  }
}

// 2つの矩形（中心＋幅高さ）の重なり面積。gap ぶん広げて判定する。
function overlapArea(a: Rect, b: Rect, gap: number): number {
  const ox = (a.w + b.w) / 2 + gap - Math.abs(a.x - b.x)
  const oy = (a.h + b.h) / 2 + gap - Math.abs(a.y - b.y)
  return ox > 0 && oy > 0 ? ox * oy : 0
}

function tracePath(ctx: CanvasRenderingContext2D, g: Geom) {
  ctx.beginPath()
  ctx.moveTo(g.p0.x, g.p0.y)
  if (g.kind === "quad") ctx.quadraticCurveTo(g.cp.x, g.cp.y, g.p2.x, g.p2.y)
  else ctx.bezierCurveTo(g.p1.x, g.p1.y, g.p2.x, g.p2.y, g.p3.x, g.p3.y)
}

export default function SchemaGraphCanvas({
  classes,
  relations,
  layoutKey,
  width,
  height,
}: {
  classes: OntologyClass[]
  relations: OntologyRelation[]
  layoutKey: string // 配置の保存先キー（プロジェクトごと）
  width: number
  height: number
}) {
  const fgRef = useRef<any>(undefined)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [hoverLinkId, setHoverLinkId] = useState<string | null>(null)
  const [showEdgeLabels, setShowEdgeLabels] = useState(true)
  const [showEnglish, setShowEnglish] = useState(false)
  const [showInherit, setShowInherit] = useState(true)
  const hasFitRef = useRef(false) // 初期フィット済みか
  const userMovedRef = useRef(false) // ユーザーがズーム/パンしたか（以後は自動フィットしない）

  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes])
  const relationById = useMemo(() => new Map(relations.map((r) => [r.id, r])), [relations])

  // classes/relations → {nodes, links} + 隣接情報
  //   リレーションは始点/終点ペアごとに1本。始点/終点のどちらかが存在しないペアは描かない。
  const { data, adjacency } = useMemo(() => {
    const measure = document.createElement("canvas").getContext("2d")!
    measure.font = `${EDGE_FONT}px ${FONT}`
    const degree = new Map<string, number>()
    const links: SchemaLink[] = []

    for (const r of relations) {
      r.classPairs.forEach((p, i) => {
        if (!classById.has(p.sourceClassId) || !classById.has(p.targetClassId)) return
        links.push({
          id: `rel:${r.id}:${i}`,
          kind: "rel",
          source: p.sourceClassId,
          target: p.targetClassId,
          relation: r,
          curvature: 0,
          loopIndex: 0,
          labelW: measure.measureText(r.name).width,
        })
        degree.set(p.sourceClassId, (degree.get(p.sourceClassId) ?? 0) + 1)
        degree.set(p.targetClassId, (degree.get(p.targetClassId) ?? 0) + 1)
      })
    }
    for (const c of classes) {
      if (c.parentId && c.parentId !== c.id && classById.has(c.parentId)) {
        links.push({ id: `isa:${c.id}`, kind: "isa", source: c.id, target: c.parentId, curvature: 0, loopIndex: 0, labelW: 0 })
        // 親子関係があるクラスは孤立扱いしない
        degree.set(c.id, (degree.get(c.id) ?? 0) + 1)
        degree.set(c.parentId, (degree.get(c.parentId) ?? 0) + 1)
      }
    }

    // 同じクラス間（向き問わず）の本数に応じて曲げ量を振り分ける。自己参照はループの番号を振る。
    const groups = new Map<string, SchemaLink[]>()
    const loopCount = new Map<string, number>()
    for (const l of links) {
      const s = endId(l.source)
      const t = endId(l.target)
      if (s === t) {
        const n = loopCount.get(s) ?? 0
        l.loopIndex = n
        loopCount.set(s, n + 1)
        continue
      }
      const key = s < t ? `${s}|${t}` : `${t}|${s}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(l)
    }
    for (const g of groups.values()) {
      if (g.length === 1) continue
      g.forEach((l, i) => {
        const c = (i - (g.length - 1) / 2) * 0.4
        // 曲げる向きは「id の小さい側→大きい側」を基準にそろえる（逆向きエッジは符号を反転）
        l.curvature = endId(l.source) < endId(l.target) ? c : -c
      })
    }

    // 保存済みの配置があるクラスはその位置に固定する（画面切替・再読込で配置が戻らないように）。
    // 新しく増えたクラスだけが力学計算で空いた場所へ置かれる。
    const saved = loadLayout(layoutKey)
    const nodes: SchemaNode[] = classes.map((c) => {
      measure.font = `600 ${NAME_FONT}px ${FONT}`
      const nameW = measure.measureText(c.name).width
      measure.font = `${EN_FONT}px ${FONT}`
      const enW = c.nameEn ? measure.measureText(c.nameEn).width : 0
      const d = degree.get(c.id) ?? 0
      const node: SchemaNode = { id: c.id, cls: c, hue: hueForClass(c.id), nameW, enW, isolated: !d, degree: d }
      const pos = saved[c.id]
      if (pos) {
        node.x = node.fx = pos.x
        node.y = node.fy = pos.y
      }
      return node
    })

    const adjacency = new Map<string, Set<string>>()
    for (const l of links) {
      const s = endId(l.source)
      const t = endId(l.target)
      if (!adjacency.has(s)) adjacency.set(s, new Set())
      if (!adjacency.has(t)) adjacency.set(t, new Set())
      adjacency.get(s)!.add(t)
      adjacency.get(t)!.add(s)
    }

    return { data: { nodes, links }, adjacency }
  }, [classes, relations, classById, layoutKey])

  // 円の半径（文字が収まる大きさ＋つながるエッジが多いほど大きく。英語名の表示有無で幅が変わる）
  const radiusOf = useCallback(
    (n: SchemaNode) => {
      const textW = Math.max(n.nameW, showEnglish ? n.enW : 0)
      return Math.max(MIN_R, textW / 2 + NODE_PAD) + Math.sqrt(n.degree) * HUB_GROWTH
    },
    [showEnglish],
  )

  // エッジの形（円周で切った始点・終点、制御点、終点での向き）
  const geomOf = useCallback(
    (l: SchemaLink): Geom | null => {
      const s = endNode(l.source)
      const t = endNode(l.target)
      if (!s || !t || s.x == null || s.y == null || t.x == null || t.y == null) return null
      const sr = radiusOf(s)
      if (s.id === t.id) {
        // 自己参照：円の右上を回るループ（円周上の2点から外向きに膨らませる）
        const L = 40 + l.loopIndex * 18
        const a0 = -Math.PI * 0.45
        const a1 = -Math.PI * 0.05
        const p0 = { x: s.x + Math.cos(a0) * sr, y: s.y + Math.sin(a0) * sr }
        const p3 = { x: s.x + Math.cos(a1) * sr, y: s.y + Math.sin(a1) * sr }
        const p1 = { x: p0.x + Math.cos(a0) * L, y: p0.y + Math.sin(a0) * L }
        const p2 = { x: p3.x + Math.cos(a1) * L, y: p3.y + Math.sin(a1) * L }
        return { kind: "loop", p0, p1, p2, p3, dir: { x: -Math.cos(a1), y: -Math.sin(a1) } }
      }
      const tr = radiusOf(t)
      const dx = t.x - s.x
      const dy = t.y - s.y
      const cp = { x: (s.x + t.x) / 2 + l.curvature * dy, y: (s.y + t.y) / 2 - l.curvature * dx }
      const p0 = clipToCircle({ x: s.x, y: s.y }, cp, sr)
      const p2 = clipToCircle({ x: t.x, y: t.y }, cp, tr)
      const ex = p2.x - cp.x
      const ey = p2.y - cp.y
      const elen = Math.hypot(ex, ey)
      if (elen < 1e-6 || Math.hypot(p2.x - p0.x, p2.y - p0.y) < 2) return null // 円が重なっている
      return { kind: "quad", p0, cp, p2, dir: { x: ex / elen, y: ey / elen } }
    },
    [radiusOf],
  )

  // 全ノードが収まる拡大率を自前で算出し、上限(MAX_ZOOM)でクランプして一度だけ滑らかにフィット。
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
      const pad = 120 // カードの幅ぶん広めに取る
      const zx = spanX > 0 ? (width - 2 * pad) / spanX : MAX_ZOOM
      const zy = spanY > 0 ? (height - 2 * pad) / spanY : MAX_ZOOM
      const z = Math.max(MIN_ZOOM, Math.min(zx, zy, MAX_ZOOM))
      fg.centerAt((bbox.x[0] + bbox.x[1]) / 2, (bbox.y[0] + bbox.y[1]) / 2, duration)
      fg.zoom(z, duration)
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

  // 重なり防止の力から最新の半径（英語名の表示有無で変わる）を参照するため
  const radiusOfRef = useRef(radiusOf)
  radiusOfRef.current = radiusOf

  // d3-force のパラメータ調整（円が大きいのでリンク長・反発ともグラフビューより広めに）
  //   gravity: 中心へ引き寄せる力。どこともつながらないクラスは反発だけで遠くへ飛ぶため強めに、
  //            つながっているクラスは弱めにして全体を広げる。
  //   collide: 円同士が近づきすぎたら、中心を結ぶ方向へ押し離す。
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    try {
      type SimNode = SchemaNode & { vx?: number; vy?: number }
      fg.d3Force("charge")?.strength(-1100).distanceMax(900)
      // ラベルが長いリレーションほど線を長くして、ラベルを置く余地を作る
      fg.d3Force("link")?.distance((l: SchemaLink) => 150 + l.labelW * 1.2)
      let simNodes: SimNode[] = []
      const gravity = (alpha: number) => {
        for (const n of simNodes) {
          const k = (n.isolated ? GRAVITY_ISOLATED : GRAVITY_LINKED) * alpha
          n.vx = (n.vx ?? 0) - (n.x ?? 0) * k
          n.vy = (n.vy ?? 0) - (n.y ?? 0) * k
        }
      }
      gravity.initialize = (nodes: SimNode[]) => { simNodes = nodes }
      const collide = () => {
        const radii = simNodes.map((n) => radiusOfRef.current(n))
        for (let i = 0; i < simNodes.length; i++) {
          const a = simNodes[i]
          for (let j = i + 1; j < simNodes.length; j++) {
            const b = simNodes[j]
            const dx = (b.x ?? 0) - (a.x ?? 0) || 0.01 // 完全に重なっているときは少しずらす
            const dy = (b.y ?? 0) - (a.y ?? 0)
            const dist = Math.hypot(dx, dy)
            const min = radii[i] + radii[j] + NODE_MARGIN
            if (dist >= min) continue
            const push = ((min - dist) / dist) * 0.25
            a.vx = (a.vx ?? 0) - dx * push
            a.vy = (a.vy ?? 0) - dy * push
            b.vx = (b.vx ?? 0) + dx * push
            b.vy = (b.vy ?? 0) + dy * push
          }
        }
      }
      collide.initialize = (nodes: SimNode[]) => { simNodes = nodes }
      fg.d3Force("gravity", gravity)
      fg.d3Force("collide", collide)
      fg.d3ReheatSimulation()
    } catch {
      /* noop */
    }
  }, [data, width, height])

  // 配置が落ち着いたら保存し、まだユーザーが動かしていなければ全体が収まるよう合わせ直す
  const handleEngineStop = useCallback(() => {
    const layout: SavedLayout = {}
    for (const n of data.nodes) {
      if (n.x != null && n.y != null) layout[n.id] = { x: Math.round(n.x), y: Math.round(n.y) }
    }
    saveLayout(layoutKey, layout)
    if (!userMovedRef.current) fitToView(500)
  }, [data, layoutKey, fitToView])

  // 保存した配置を捨てて、力学計算で並べ直す
  const resetLayout = useCallback(() => {
    clearLayout(layoutKey)
    for (const n of data.nodes) {
      n.fx = undefined
      n.fy = undefined
    }
    userMovedRef.current = false
    fgRef.current?.d3ReheatSimulation()
  }, [data, layoutKey])

  // ホバー中の対象（エッジ優先。エッジをホバーしたら両端のクラスのみ強調）
  const hoverLink = hoverLinkId ? data.links.find((l) => l.id === hoverLinkId) ?? null : null
  const hovering = !!hoverId || !!hoverLink

  const isNodeHi = useCallback(
    (id: string) => {
      if (hoverLink) return endId(hoverLink.source) === id || endId(hoverLink.target) === id
      if (!hoverId) return true
      return id === hoverId || !!adjacency.get(hoverId)?.has(id)
    },
    [hoverId, hoverLink, adjacency],
  )
  const isLinkHi = useCallback(
    (l: SchemaLink) => {
      if (hoverLink) return l.id === hoverLink.id
      if (!hoverId) return true
      return endId(l.source) === hoverId || endId(l.target) === hoverId
    },
    [hoverId, hoverLink],
  )

  // 毎フレーム、描くエッジラベルの位置を決める（paintLink・ポインタ判定はこの結果を使う）。
  //   各ラベルを曲線上の候補位置に順に当て、配置済みのラベルとクラスの円に重ならない最初の位置に置く。
  //   線の上が埋まっていれば線のすぐ上・下も試し、それでも重なる場合は重なりが最も小さい位置に置く。
  const labelRectsRef = useRef(new Map<string, Rect>())
  const layoutLabels = useCallback(
    (ctx: CanvasRenderingContext2D, globalScale: number) => {
      const placed = labelRectsRef.current
      placed.clear()
      if (!showEdgeLabels) return
      // クラスの円は外接する正方形として扱う
      const cards: Rect[] = data.nodes.map((n) => {
        const r = radiusOf(n)
        return { x: n.x ?? 0, y: n.y ?? 0, w: r * 2, h: r * 2 }
      })
      const labels: Rect[] = []
      ctx.save()
      for (const link of data.links) {
        const r = link.relation
        if (!r) continue
        const hi = isLinkHi(link)
        if (hovering && !hi) continue // ホバー中は対象エッジのラベルのみ
        if (globalScale < 0.35 && !(hovering && hi)) continue // 縮小しすぎたときは省く
        const g = geomOf(link)
        if (!g) continue
        const { w, h } = edgeLabelSize(ctx, r.name, showEnglish && r.nameEn ? r.nameEn : "")
        let best: Rect | null = null
        let bestCost = Infinity
        // まず線の上の候補位置を順に試し、どこも空いていなければ線のすぐ上・下にずらして試す
        const candidates = [0, -1, 1, -2, 2].flatMap((k) => LABEL_POSITIONS.map((t) => ({ t, dy: k * (h + LABEL_GAP) })))
        for (const { t, dy } of candidates) {
          const p = pointAt(g, t)
          const rect = { x: p.x, y: p.y + dy, w, h }
          let cost = 0
          for (const o of labels) cost += overlapArea(rect, o, LABEL_GAP)
          for (const o of cards) cost += overlapArea(rect, o, LABEL_GAP)
          if (cost < bestCost) {
            best = rect
            bestCost = cost
          }
          if (cost === 0) break
        }
        if (best) {
          labels.push(best)
          placed.set(link.id, best)
        }
      }
      ctx.restore()
    },
    [data, radiusOf, geomOf, isLinkHi, hovering, showEdgeLabels, showEnglish],
  )

  // 背景：周辺減光（画面座標）＋ドット方眼（パン・ズームに追従）。
  //   ドットは1マスごと、5マスごとに小さな十字。拡大率が小さいときは十字だけにする。
  const paintBackground = useCallback((ctx: CanvasRenderingContext2D, globalScale: number) => {
    const tr = ctx.getTransform()
    if (!tr.a || !tr.d) return
    const cw = ctx.canvas.width
    const ch = ctx.canvas.height
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    const vg = ctx.createRadialGradient(cw / 2, ch / 2, 0, cw / 2, ch / 2, Math.max(cw, ch) * 0.75)
    vg.addColorStop(0, "rgba(40,90,150,0.22)")
    vg.addColorStop(1, "rgba(0,0,0,0.45)")
    ctx.fillStyle = vg
    ctx.fillRect(0, 0, cw, ch)
    ctx.restore()

    const x0 = -tr.e / tr.a
    const x1 = (cw - tr.e) / tr.a
    const y0 = -tr.f / tr.d
    const y1 = (ch - tr.f) / tr.d
    const major = GRID * 5
    ctx.save()
    if (GRID * globalScale >= 10) {
      const dot = 1.4 / globalScale
      ctx.fillStyle = "rgba(140,185,235,0.16)"
      for (let x = Math.floor(x0 / GRID) * GRID; x <= x1; x += GRID) {
        for (let y = Math.floor(y0 / GRID) * GRID; y <= y1; y += GRID) {
          ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot)
        }
      }
    }
    const arm = 4 / globalScale
    ctx.strokeStyle = "rgba(140,185,235,0.28)"
    ctx.lineWidth = 1 / globalScale
    ctx.beginPath()
    for (let x = Math.floor(x0 / major) * major; x <= x1; x += major) {
      for (let y = Math.floor(y0 / major) * major; y <= y1; y += major) {
        ctx.moveTo(x - arm, y)
        ctx.lineTo(x + arm, y)
        ctx.moveTo(x, y - arm)
        ctx.lineTo(x, y + arm)
      }
    }
    ctx.stroke()
    ctx.restore()
  }, [])

  const paintNode = useCallback(
    (node: SchemaNode, ctx: CanvasRenderingContext2D) => {
      const x = node.x ?? 0
      const y = node.y ?? 0
      const r = radiusOf(node)
      const hi = isNodeHi(node.id)
      const isHover = node.id === hoverId
      ctx.save()
      ctx.globalAlpha = hi ? (node.isolated && !hovering ? 0.5 : 1) : 0.15

      // 本体：中心がクラス色にほのかに光る円（つながりのあるクラスは外側も発光）
      if (!node.isolated) {
        ctx.shadowColor = neon(node.hue, 0.85)
        ctx.shadowBlur = isHover ? 30 : 14
      }
      const fill = ctx.createRadialGradient(x, y - r * 0.35, r * 0.1, x, y, r)
      fill.addColorStop(0, neon(node.hue, 0.34))
      fill.addColorStop(0.75, "rgba(12,30,54,0.96)")
      fill.addColorStop(1, "rgba(9,22,40,0.98)")
      ctx.beginPath()
      ctx.arc(x, y, r, 0, 2 * Math.PI)
      ctx.fillStyle = fill
      ctx.fill()
      ctx.shadowBlur = 0

      // 縁取り（どこともつながらないクラスは点線）
      ctx.lineWidth = isHover ? 2.2 : 1.5
      ctx.strokeStyle = neon(node.hue, 0.95)
      if (node.isolated) ctx.setLineDash([4, 3])
      ctx.stroke()
      ctx.setLineDash([])

      // 外側の細い点線リング（計器のような装飾）
      ctx.beginPath()
      ctx.arc(x, y, r + 4, 0, 2 * Math.PI)
      ctx.lineWidth = 0.7
      ctx.strokeStyle = neon(node.hue, isHover ? 0.7 : 0.3)
      ctx.setLineDash([1.5, 3])
      ctx.stroke()
      ctx.setLineDash([])

      // クラス名・英語名（円の中央）
      const withEn = showEnglish && !!node.cls.nameEn
      const nameY = withEn ? y - (EN_FONT + LINE_GAP) / 2 : y
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.font = `600 ${NAME_FONT}px ${FONT}`
      ctx.fillStyle = "#f0f6ff"
      ctx.fillText(node.cls.name, x, nameY)
      if (withEn) {
        ctx.font = `${EN_FONT}px ${FONT}`
        ctx.fillStyle = neon(node.hue, 0.9)
        ctx.fillText(node.cls.nameEn!, x, nameY + (NAME_FONT + EN_FONT) / 2 + LINE_GAP)
      }
      ctx.restore()
    },
    [radiusOf, isNodeHi, hoverId, hovering, showEnglish],
  )

  const paintNodePointerArea = useCallback(
    (node: SchemaNode, color: string, ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(node.x ?? 0, node.y ?? 0, radiusOf(node) + 2, 0, 2 * Math.PI)
      ctx.fill()
    },
    [radiusOf],
  )

  const paintLink = useCallback(
    (link: SchemaLink, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const g = geomOf(link)
      if (!g) return
      const hi = isLinkHi(link)
      const isa = link.kind === "isa"
      const focus = hovering && hi
      const alpha = !hovering ? (isa ? 0.55 : 0.6) : hi ? 1 : 0.07
      const end = g.kind === "quad" ? g.p2 : g.p3
      const sHue = endNode(link.source)?.hue ?? 210
      const tHue = endNode(link.target)?.hue ?? 210
      // 継承は淡い単色、リレーションは始点→終点のクラス色のグラデーション（向きが色で分かる）
      let stroke: string | CanvasGradient = `rgba(170,200,235,${alpha})`
      if (!isa) {
        const grad = ctx.createLinearGradient(g.p0.x, g.p0.y, end.x, end.y)
        grad.addColorStop(0, neon(sHue, alpha * 0.8))
        grad.addColorStop(1, neon(tHue, alpha))
        stroke = grad
      }
      const color = isa ? `rgba(170,200,235,${alpha})` : neon(tHue, Math.min(1, alpha + 0.2))

      ctx.save()
      // 線（ホバー中の対象は発光）
      if (focus) {
        ctx.shadowColor = isa ? "rgba(170,200,235,0.8)" : neon(tHue, 0.8)
        ctx.shadowBlur = 8
      }
      ctx.lineWidth = focus ? 1.8 : 1.1
      ctx.strokeStyle = stroke
      if (isa) ctx.setLineDash([5, 4])
      tracePath(ctx, g)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.shadowBlur = 0

      // 矢印（リレーション=塗りつぶし、継承=白抜き三角）
      const ax = end.x - g.dir.x * ARROW_LEN
      const ay = end.y - g.dir.y * ARROW_LEN
      const half = isa ? 4.5 : 3.5
      ctx.beginPath()
      ctx.moveTo(end.x, end.y)
      ctx.lineTo(ax - g.dir.y * half, ay + g.dir.x * half)
      ctx.lineTo(ax + g.dir.y * half, ay - g.dir.x * half)
      ctx.closePath()
      if (isa) {
        ctx.fillStyle = BG
        ctx.fill()
        ctx.lineWidth = 1.1
        ctx.stroke()
      } else {
        ctx.fillStyle = color
        ctx.fill()
      }

      // ラベル（リレーション名＋英語名）。位置は layoutLabels で決めたもの。
      const r = link.relation
      const rect = labelRectsRef.current.get(link.id)
      if (r && rect) {
        const en = showEnglish && r.nameEn ? r.nameEn : ""
        const { x: lx, y: ly, w, h } = rect
        roundRect(ctx, lx - w / 2, ly - h / 2, w, h, Math.min(6, h / 2))
        ctx.fillStyle = "rgba(8,20,38,0.92)"
        ctx.fill()
        ctx.lineWidth = 0.8
        ctx.strokeStyle = neon(tHue, focus ? 0.85 : 0.35)
        ctx.stroke()
        ctx.textAlign = "center"
        ctx.textBaseline = "top"
        const top = ly - h / 2 + 2.5
        ctx.font = `${EDGE_FONT}px ${FONT}`
        ctx.fillStyle = "#e6f0ff"
        ctx.fillText(r.name, lx, top)
        if (en) {
          ctx.font = `${EDGE_EN_FONT}px ${FONT}`
          ctx.fillStyle = "rgba(165,200,240,0.8)"
          ctx.fillText(en, lx, top + EDGE_FONT + 2)
        }
      }
      ctx.restore()
    },
    [geomOf, isLinkHi, hovering, showEnglish],
  )

  const paintLinkPointerArea = useCallback(
    (link: SchemaLink, color: string, ctx: CanvasRenderingContext2D) => {
      const g = geomOf(link)
      if (!g) return
      ctx.save()
      ctx.strokeStyle = color
      ctx.lineWidth = 8
      tracePath(ctx, g)
      ctx.stroke()
      // ラベルの上でもホバーできるようにする
      const rect = labelRectsRef.current.get(link.id)
      if (rect) {
        ctx.fillStyle = color
        ctx.fillRect(rect.x - rect.w / 2, rect.y - rect.h / 2, rect.w, rect.h)
      }
      ctx.restore()
    },
    [geomOf],
  )

  const nodeTooltip = useCallback(
    (n: SchemaNode) => {
      const c = n.cls
      const parent = c.parentId ? classById.get(c.parentId)?.name : undefined
      return (
        `<div class="gv-tt-name">${esc(c.name)}</div>` +
        (c.nameEn ? `<div class="gv-tt-sub">${esc(c.nameEn)}</div>` : "") +
        (parent ? `<div class="gv-tt-sub">上位クラス：${esc(parent)}</div>` : "") +
        (c.description ? `<div class="gv-tt-desc">${esc(c.description)}</div>` : "")
      )
    },
    [classById],
  )

  const linkTooltip = useCallback(
    (l: SchemaLink) => {
      const s = endNode(l.source)?.cls.name ?? ""
      const t = endNode(l.target)?.cls.name ?? ""
      if (l.kind === "isa") {
        return `<div class="gv-tt-name">上位クラス</div><div class="gv-tt-sub">${esc(s)} → ${esc(t)}</div>`
      }
      const r = l.relation!
      const parent = r.parentRelationId ? relationById.get(r.parentRelationId)?.name : undefined
      // 成立条件を日本語1行の箇条書きで表示（グラフビューと同じ形式）
      const conds = r.conditions ?? []
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
      return (
        `<div class="gv-tt-name">${esc(r.name)}</div>` +
        (r.nameEn ? `<div class="gv-tt-sub">${esc(r.nameEn)}</div>` : "") +
        `<div class="gv-tt-sub">${esc(s)} → ${esc(t)}</div>` +
        (parent ? `<div class="gv-tt-sub">上位リレーション：${esc(parent)}</div>` : "") +
        (r.description ? `<div class="gv-tt-desc">${esc(r.description)}</div>` : "") +
        condHtml
      )
    },
    [relationById],
  )

  const handleNodeClick = useCallback((node: SchemaNode) => {
    const fg = fgRef.current
    if (fg && node.x != null && node.y != null) fg.centerAt(node.x, node.y, 500)
  }, [])

  const handleNodeDragEnd = useCallback((node: SchemaNode) => {
    userMovedRef.current = true // 以後は自動フィットしない
    // ドロップ位置に固定（配置を保持）
    node.fx = node.x
    node.fy = node.y
  }, [])

  const toggles = [
    { label: "エッジ名", on: showEdgeLabels, toggle: () => setShowEdgeLabels((v) => !v) },
    { label: "英語名", on: showEnglish, toggle: () => setShowEnglish((v) => !v) },
    { label: "継承", on: showInherit, toggle: () => setShowInherit((v) => !v) },
  ]

  return (
    // 図の上でホイール・ドラッグ・クリックしたら自動フィットを止める（勝手に戻さない）。
    // force-graph の onZoom は自前のズームや初期化でも発火して区別できないため、入力イベントで判定する。
    <div
      className="relative"
      style={{ width, height }}
      onWheelCapture={(e) => { if ((e.target as HTMLElement).tagName === "CANVAS") userMovedRef.current = true }}
      onPointerDownCapture={(e) => { if ((e.target as HTMLElement).tagName === "CANVAS") userMovedRef.current = true }}
    >
      <div className="absolute right-3 top-3 z-10 flex gap-1.5">
        {toggles.map((t) => (
          <button
            key={t.label}
            type="button"
            onClick={t.toggle}
            className="rounded-md border border-sky-200/20 bg-[#0a1a2f]/80 px-2.5 py-1 text-xs text-sky-50 backdrop-blur-sm transition-colors hover:bg-sky-900/60"
          >
            {t.label}: {t.on ? "ON" : "OFF"}
          </button>
        ))}
        <button
          type="button"
          onClick={resetLayout}
          className="rounded-md border border-sky-200/20 bg-[#0a1a2f]/80 px-2.5 py-1 text-xs text-sky-50 backdrop-blur-sm transition-colors hover:bg-sky-900/60"
        >
          配置をリセット
        </button>
      </div>
      <ForceGraph2D
        ref={fgRef}
        width={width}
        height={height}
        graphData={data}
        backgroundColor={BG}
        onRenderFramePre={((ctx: CanvasRenderingContext2D, k: number) => { paintBackground(ctx, k); layoutLabels(ctx, k) }) as any}
        nodeRelSize={1}
        nodeVal={((n: SchemaNode) => { const r = radiusOf(n); return r * r }) as any}
        nodeCanvasObject={paintNode as any}
        nodePointerAreaPaint={paintNodePointerArea as any}
        nodeLabel={nodeTooltip as any}
        // 継承エッジは非表示にしても力学計算には残す（切替で配置が崩れないように）
        linkVisibility={((l: SchemaLink) => l.kind === "rel" || showInherit) as any}
        linkCanvasObjectMode={(() => "replace") as any}
        linkCanvasObject={paintLink as any}
        linkPointerAreaPaint={paintLinkPointerArea as any}
        linkLabel={linkTooltip as any}
        onNodeHover={(n: SchemaNode | null) => setHoverId(n?.id ?? null)}
        onLinkHover={((l: SchemaLink | null) => setHoverLinkId(l?.id ?? null)) as any}
        onNodeClick={handleNodeClick as any}
        onNodeDragEnd={handleNodeDragEnd as any}
        onEngineStop={handleEngineStop}
        warmupTicks={80}
        cooldownTime={2000}
      />
    </div>
  )
}
