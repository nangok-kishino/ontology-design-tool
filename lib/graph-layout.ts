// グラフビューの配置計算（クラス単位の階層レイアウト）。
//
// 列はクラスで決める。同じクラスのインスタンスは必ず同じ列に入る。
// 列の順番は、クラスどうしの関係をたどって決める：どのクラスからも
// 指されていないクラスが左端、そこから指された先が次の列……と右へ流れる。
// 同じ深さのクラスは同じ列に収まるので、部品のように兄弟関係のクラスは
// まとめて1列に並ぶ。
//
//   製品シリーズ │ 商品 │ 支柱・ビーム・板… │ 網・バー… │ 棚受…
//   テーマ       │      │                    │           │
//
// 1列が高くなりすぎるときだけ、クラスの切れ目で列を分ける
// （クラスの途中では折らない＝同じクラスは必ず1列に収まる）。
//
// 循環があっても止まるように、列が決まらなかったクラスは
// 「指してきた相手の次の列」に置く（相手も未定なら左端）。

export type LayoutEdge = { source: string; target: string }

// 配置にはカードの実寸が要る（幅で列の間隔、高さで行の間隔が決まる）
export type SizedNode = { id: string; w: number; h: number; classId?: string | null }

export type PlacedNode = { x: number; y: number; layer: number }

export type LayeredOptions = {
  // 列と列の間隔
  hGap?: number
  // 行と行の間隔
  vGap?: number
  // クラスが変わるところに足す余白
  classGap?: number
  // 1列に積む高さの目安（これを超えたらクラスの切れ目で列を分ける）
  maxPerColumn?: number
}

const NO_CLASS = "__none__"

// 関係の向きをたどって、それぞれの列（左から何番目か）を決める
function assignLayers(ids: string[], outs: Map<string, Set<string>>, ins: Map<string, Set<string>>): Map<string, number> {
  const layer = new Map<string, number>()
  const indeg = new Map(ids.map((id) => [id, (ins.get(id) ?? new Set()).size]))
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
    const placed = [...(ins.get(id) ?? [])].map((p) => layer.get(p)).filter((v): v is number => v !== undefined)
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
  const vGap = options.vGap ?? 14
  const classGap = options.classGap ?? 22
  const maxPerColumn = options.maxPerColumn ?? 18

  const ids = nodes.map((n) => n.id)
  const size = new Map(nodes.map((n) => [n.id, { w: n.w, h: n.h }]))
  const classOf = new Map(nodes.map((n) => [n.id, n.classId || NO_CLASS]))

  // クラスどうしの関係に畳んでから列を決める
  const classIds: string[] = []
  for (const id of ids) {
    const c = classOf.get(id)!
    if (!classIds.includes(c)) classIds.push(c)
  }
  const classOuts = new Map<string, Set<string>>(classIds.map((c) => [c, new Set()]))
  const classIns = new Map<string, Set<string>>(classIds.map((c) => [c, new Set()]))
  const outs = new Map<string, string[]>(ids.map((id) => [id, []]))
  const ins = new Map<string, string[]>(ids.map((id) => [id, []]))
  for (const e of edges) {
    if (e.source === e.target) continue
    if (!outs.has(e.source) || !ins.has(e.target)) continue
    outs.get(e.source)!.push(e.target)
    ins.get(e.target)!.push(e.source)
    const cs = classOf.get(e.source)!
    const ct = classOf.get(e.target)!
    if (cs === ct) continue
    classOuts.get(cs)!.add(ct)
    classIns.get(ct)!.add(cs)
  }

  const classLayer = assignLayers(classIds, classOuts, classIns)
  const maxLayer = Math.max(0, ...classLayer.values())
  const layerOf = (id: string) => classLayer.get(classOf.get(id)!) ?? 0

  // 列ごとに、クラスの塊に分けて並べる
  const classRank = new Map(classIds.map((c, i) => [c, i]))
  const layers: string[][] = Array.from({ length: maxLayer + 1 }, () => [])
  for (const id of ids) layers[layerOf(id)].push(id)
  for (const row of layers) {
    row.sort((a, b) => (classRank.get(classOf.get(a)!) ?? 0) - (classRank.get(classOf.get(b)!) ?? 0) || a.localeCompare(b))
  }

  // クラスの中だけ、つながっている相手の位置に寄せて並べ替える（交差を減らす）
  const reorder = (row: string[], neighborRow: string[], neighbors: Map<string, string[]>) => {
    const pos = new Map(neighborRow.map((id, i) => [id, i]))
    const score = new Map<string, number>()
    row.forEach((id, i) => {
      const list = (neighbors.get(id) ?? []).map((n) => pos.get(n)).filter((v): v is number => v !== undefined)
      score.set(id, list.length > 0 ? list.reduce((a, b) => a + b, 0) / list.length : i)
    })
    row.sort(
      (a, b) =>
        (classRank.get(classOf.get(a)!) ?? 0) - (classRank.get(classOf.get(b)!) ?? 0) ||
        (score.get(a) ?? 0) - (score.get(b) ?? 0) ||
        a.localeCompare(b),
    )
  }
  for (let pass = 0; pass < 3; pass++) {
    for (let l = 1; l <= maxLayer; l++) reorder(layers[l], layers[l - 1], ins)
    for (let l = maxLayer - 1; l >= 0; l--) reorder(layers[l], layers[l + 1], outs)
  }

  // 高くなりすぎる列は、クラスの切れ目で分ける（クラスの途中では折らない）
  const chunks: string[][][] = layers.map((row) => {
    const blocks: string[][] = []
    for (const id of row) {
      const last = blocks[blocks.length - 1]
      if (last && classOf.get(last[0]) === classOf.get(id)) last.push(id)
      else blocks.push([id])
    }
    const cols: string[][] = []
    let current: string[] = []
    for (const block of blocks) {
      if (current.length > 0 && current.length + block.length > maxPerColumn) {
        cols.push(current)
        current = []
      }
      current = current.concat(block)
    }
    if (current.length > 0 || cols.length === 0) cols.push(current)
    return cols
  })

  // 列の中心（その列でいちばん広いカードに合わせる）
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

  // 縦位置：順番どおりに積み、つながっている相手の中心へ寄せ直す
  const y = new Map<string, number>()
  const stack = (col: string[]) => {
    let cursor = 0
    let prevClass: string | null = null
    for (const id of col) {
      const h = size.get(id)?.h ?? 36
      const cls = classOf.get(id)!
      if (prevClass !== null && cls !== prevClass) cursor += classGap
      y.set(id, cursor + h / 2)
      cursor += h + vGap
      prevClass = cls
    }
  }
  for (const layerChunks of chunks) layerChunks.forEach(stack)

  // 並び順と最低間隔を保ったまま、できるだけ相手の正面へ
  const pullToward = (col: string[], neighbors: Map<string, string[]>) => {
    const want = col.map((id) => {
      const list = (neighbors.get(id) ?? []).map((n) => y.get(n)).filter((v): v is number => v !== undefined)
      return list.length > 0 ? list.reduce((a, b) => a + b, 0) / list.length : y.get(id) ?? 0
    })
    let prevBottom = -Infinity
    let prevClass: string | null = null
    col.forEach((id, i) => {
      const h = size.get(id)?.h ?? 36
      const cls = classOf.get(id)!
      const gap = prevClass !== null && cls !== prevClass ? vGap + classGap : vGap
      const top = Math.max(want[i] - h / 2, prevBottom + gap)
      y.set(id, top + h / 2)
      prevBottom = top + h
      prevClass = cls
    })
  }
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
