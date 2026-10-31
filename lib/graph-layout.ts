// グラフビューの配置計算（階層レイアウト）。
//
// 関係の向きで段を決める：どこからも指されていないノードが左端の段、
// そこから指された先が次の段……と右へ流れる。同じ段のノードは縦に積む。
// これで「製品シリーズ → 商品 → 部品」のような構造がそのまま左右に並ぶ。
//
//   製品シリーズ ┬→ 商品RC ─→ 部品…
//   軽量棚       ├→ 商品RE
//                └→ 商品RL
//   テーマ ──────→ 商品RL
//
// 段の中の並び順は、つながっている相手の位置に寄せて決める（線の交差を減らす）。
// 同じクラスのインスタンスは、並び順が同じなら隣り合うようにする。
//
// 循環があっても止まるように、段が決まらなかったノードは
// 「指してきた相手の次の段」に置く（相手も未定なら左端）。

export type LayoutEdge = { source: string; target: string }

// 配置にはカードの実寸が要る（幅で段の間隔、高さで行の間隔が決まる）
export type SizedNode = { id: string; w: number; h: number; classId?: string | null }

export type PlacedNode = { x: number; y: number; layer: number }

export type LayeredOptions = {
  // 段と段の間隔
  hGap?: number
  // 行と行の間隔
  vGap?: number
  // クラスが変わるところに足す余白
  classGap?: number
  // 1つの段に縦何枚まで積むか。超えたら段を複数列に折り返す
  // （40件を1列に積むと縦に長すぎて、全体を映したときに字が潰れるため）
  maxPerColumn?: number
}

// 関係の向きをたどって段（左から何番目か）を決める
function assignLayers(ids: string[], outs: Map<string, string[]>, ins: Map<string, string[]>): Map<string, number> {
  const layer = new Map<string, number>()
  const indeg = new Map(ids.map((id) => [id, (ins.get(id) ?? []).length]))
  const queue = ids.filter((id) => (indeg.get(id) ?? 0) === 0)
  for (const id of queue) layer.set(id, 0)
  let head = 0
  while (head < queue.length) {
    const id = queue[head++]
    for (const next of outs.get(id) ?? []) {
      layer.set(next, Math.max(layer.get(next) ?? 0, (layer.get(id) ?? 0) + 1))
      const left = (indeg.get(next) ?? 1) - 1
      indeg.set(next, left)
      if (left === 0) queue.push(next)
    }
  }
  // 循環に取り残されたぶん
  for (const id of ids) {
    if (layer.has(id)) continue
    const placed = (ins.get(id) ?? []).map((p) => layer.get(p)).filter((v): v is number => v !== undefined)
    layer.set(id, placed.length > 0 ? Math.max(...placed) + 1 : 0)
  }
  return layer
}

export function layeredLayout(
  nodes: SizedNode[],
  edges: LayoutEdge[],
  options: LayeredOptions = {},
): Map<string, PlacedNode> {
  const hGap = options.hGap ?? 110
  const vGap = options.vGap ?? 16
  const classGap = options.classGap ?? 14
  const maxPerColumn = options.maxPerColumn ?? 14

  const ids = nodes.map((n) => n.id)
  const size = new Map(nodes.map((n) => [n.id, { w: n.w, h: n.h }]))
  const classOf = new Map(nodes.map((n) => [n.id, n.classId ?? ""]))
  const outs = new Map<string, string[]>(ids.map((id) => [id, []]))
  const ins = new Map<string, string[]>(ids.map((id) => [id, []]))
  for (const e of edges) {
    if (e.source === e.target) continue
    if (!outs.has(e.source) || !ins.has(e.target)) continue
    outs.get(e.source)!.push(e.target)
    ins.get(e.target)!.push(e.source)
  }

  const layer = assignLayers(ids, outs, ins)
  const maxLayer = Math.max(0, ...layer.values())
  const layers: string[][] = Array.from({ length: maxLayer + 1 }, () => [])
  // 同じクラスが固まるよう、クラスの初出順を控えておく
  const classRank = new Map<string, number>()
  for (const id of ids) {
    const c = classOf.get(id) ?? ""
    if (!classRank.has(c)) classRank.set(c, classRank.size)
  }
  for (const id of ids) layers[layer.get(id) ?? 0].push(id)
  for (const row of layers) {
    row.sort((a, b) => (classRank.get(classOf.get(a) ?? "") ?? 0) - (classRank.get(classOf.get(b) ?? "") ?? 0) || a.localeCompare(b))
  }

  // 段の中の並び：つながっている相手の位置の平均に寄せる（交差を減らす）
  const indexIn = (row: string[]) => new Map(row.map((id, i) => [id, i]))
  const reorder = (row: string[], neighborRow: string[], neighbors: Map<string, string[]>) => {
    const pos = indexIn(neighborRow)
    const score = new Map<string, number>()
    row.forEach((id, i) => {
      const list = (neighbors.get(id) ?? []).map((n) => pos.get(n)).filter((v): v is number => v !== undefined)
      score.set(id, list.length > 0 ? list.reduce((a, b) => a + b, 0) / list.length : i)
    })
    row.sort(
      (a, b) =>
        (score.get(a) ?? 0) - (score.get(b) ?? 0) ||
        (classRank.get(classOf.get(a) ?? "") ?? 0) - (classRank.get(classOf.get(b) ?? "") ?? 0) ||
        a.localeCompare(b),
    )
  }
  for (let pass = 0; pass < 3; pass++) {
    for (let l = 1; l <= maxLayer; l++) reorder(layers[l], layers[l - 1], ins)
    for (let l = maxLayer - 1; l >= 0; l--) reorder(layers[l], layers[l + 1], outs)
  }

  // 多すぎる段は複数列に折り返す（縦に長すぎると全体を映したとき字が潰れる）
  const chunks: string[][][] = layers.map((row) => {
    const cols = Math.max(1, Math.ceil(row.length / maxPerColumn))
    const per = Math.ceil(row.length / cols)
    const out: string[][] = []
    for (let i = 0; i < row.length; i += per) out.push(row.slice(i, i + per))
    return out.length > 0 ? out : [[]]
  })

  // 段ごとの列の中心（その段でいちばん広いカードに合わせる）。
  // 折り返した列は少し詰めて並べる。
  const widest = layers.map((row) => Math.max(0, ...row.map((id) => size.get(id)?.w ?? 100)))
  const subGap = hGap * 0.45
  const slotX: number[][] = []
  let cursorX = 0
  for (let l = 0; l <= maxLayer; l++) {
    const w = widest[l]
    const xs: number[] = []
    for (let k = 0; k < chunks[l].length; k++) xs.push(cursorX + w / 2 + k * (w + subGap))
    slotX.push(xs)
    cursorX = (xs[xs.length - 1] ?? cursorX) + w / 2 + hGap
  }

  // 縦位置：まず順番どおりに積み、つながっている相手の中心へ寄せ直す
  const y = new Map<string, number>()
  const stack = (row: string[]) => {
    let cursor = 0
    let prevClass: string | null = null
    for (const id of row) {
      const h = size.get(id)?.h ?? 36
      const cls = classOf.get(id) ?? ""
      if (prevClass !== null && cls !== prevClass) cursor += classGap
      y.set(id, cursor + h / 2)
      cursor += h + vGap
      prevClass = cls
    }
  }
  for (const layerChunks of chunks) layerChunks.forEach(stack)

  const pullToward = (row: string[], neighbors: Map<string, string[]>) => {
    const want = row.map((id) => {
      const list = (neighbors.get(id) ?? []).map((n) => y.get(n)).filter((v): v is number => v !== undefined)
      return list.length > 0 ? list.reduce((a, b) => a + b, 0) / list.length : (y.get(id) ?? 0)
    })
    // 並び順と最低間隔を保ったまま、できるだけ希望の位置へ
    let prevBottom = -Infinity
    let prevClass: string | null = null
    row.forEach((id, i) => {
      const h = size.get(id)?.h ?? 36
      const cls = classOf.get(id) ?? ""
      const gap = prevClass !== null && cls !== prevClass ? vGap + classGap : vGap
      const top = Math.max(want[i] - h / 2, prevBottom + gap)
      y.set(id, top + h / 2)
      prevBottom = top + h
      prevClass = cls
    })
  }
  // 寄せ直しは1列の段だけ（折り返した段は列ごとに積んだままにする）
  for (let pass = 0; pass < 4; pass++) {
    for (let l = maxLayer - 1; l >= 0; l--) if (chunks[l].length === 1) pullToward(layers[l], outs)
    for (let l = 1; l <= maxLayer; l++) if (chunks[l].length === 1) pullToward(layers[l], ins)
  }

  const placed = new Map<string, PlacedNode>()
  for (let l = 0; l <= maxLayer; l++) {
    chunks[l].forEach((col, k) => {
      for (const id of col) placed.set(id, { x: slotX[l][k], y: y.get(id) ?? 0, layer: l })
    })
  }
  return placed
}
