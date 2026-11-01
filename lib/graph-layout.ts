// グラフビューの配置計算（クラス単位の階層レイアウト）。
//
// 列は「クラスの括り」で決める。括りはルートクラス（親をたどった先の一番上）で、
// 支柱・ビーム・板…のように同じ親（部品図面）を持つクラスは同じ括り＝同じ列に入る。
// 同じクラスのインスタンスが別々の列に散ることはない。
//
// 1つの列には1つの括りだけが入る。列の順番は、括りどうしの関係をたどって
// 決める：どの括りからも指されていないものが左、そこから指された先が右。
// 深さが同じ括りどうしは、クラス一覧の並び順で左右に分かれる。
// 括りの中での関係（部品どうしの構成など）は列を分けない。
//
//   テーマ │ 商品 │ 製品シリーズ │ 部品図面（支柱・ビーム・板・金具…）
//
// 循環があっても止まるように、列が決まらなかった括りは
// 「指してきた相手の次の列」に置く（相手も未定なら左端）。

export type LayoutEdge = { source: string; target: string }

// 配置にはカードの実寸が要る（幅で列の間隔、高さで行の間隔が決まる）。
//   classId : 列の中で並べる単位（同じクラスは隣り合う）
//   groupId : 列を決める単位（ふつうはルートクラス。省略時は classId）
export type SizedNode = {
  id: string
  w: number
  h: number
  classId?: string | null
  groupId?: string | null
}

export type PlacedNode = { x: number; y: number; layer: number }

export type LayeredOptions = {
  // 列と列の間隔
  hGap?: number
  // 行と行の間隔
  vGap?: number
  // クラスが変わるところに足す余白
  classGap?: number
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

  const ids = nodes.map((n) => n.id)
  const size = new Map(nodes.map((n) => [n.id, { w: n.w, h: n.h }]))
  const classOf = new Map(nodes.map((n) => [n.id, n.classId || NO_CLASS]))
  const groupOf = new Map(nodes.map((n) => [n.id, n.groupId || n.classId || NO_CLASS]))

  // 括りどうしの関係に畳んでから列を決める
  const groupIds: string[] = []
  for (const id of ids) {
    const g = groupOf.get(id)!
    if (!groupIds.includes(g)) groupIds.push(g)
  }
  const groupOuts = new Map<string, Set<string>>(groupIds.map((g) => [g, new Set()]))
  const groupIns = new Map<string, Set<string>>(groupIds.map((g) => [g, new Set()]))
  const outs = new Map<string, string[]>(ids.map((id) => [id, []]))
  const ins = new Map<string, string[]>(ids.map((id) => [id, []]))
  for (const e of edges) {
    if (e.source === e.target) continue
    if (!outs.has(e.source) || !ins.has(e.target)) continue
    outs.get(e.source)!.push(e.target)
    ins.get(e.target)!.push(e.source)
    const gs = groupOf.get(e.source)!
    const gt = groupOf.get(e.target)!
    if (gs === gt) continue // 括りの中の関係では列を分けない
    groupOuts.get(gs)!.add(gt)
    groupIns.get(gt)!.add(gs)
  }

  // 1つの列には1つの括りだけを入れる（別の括りが同じ列に混ざらないように）。
  // 列の順番は、関係の深さが先、同じ深さならクラス一覧の並び順。
  const groupLayer = assignLayers(groupIds, groupOuts, groupIns)
  const groupRank = new Map(groupIds.map((g, i) => [g, i]))
  const columnOf = new Map(
    [...groupIds]
      .sort(
        (a, b) =>
          (groupLayer.get(a) ?? 0) - (groupLayer.get(b) ?? 0) ||
          (groupRank.get(a) ?? 0) - (groupRank.get(b) ?? 0),
      )
      .map((g, i) => [g, i]),
  )
  const maxLayer = groupIds.length - 1
  const layerOf = (id: string) => columnOf.get(groupOf.get(id)!) ?? 0

  // 列ごとに、クラスの塊に分けて並べる（nodes の順番をクラスの並び順として使う）
  const classRank = new Map<string, number>()
  for (const id of ids) {
    const c = classOf.get(id)!
    if (!classRank.has(c)) classRank.set(c, classRank.size)
  }
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

  // 列の中心（その列でいちばん広いカードに合わせる）
  const widest = layers.map((row) => Math.max(0, ...row.map((id) => size.get(id)?.w ?? 100)))
  const colCenter: number[] = [widest[0] / 2]
  for (let l = 1; l <= maxLayer; l++) colCenter[l] = colCenter[l - 1] + widest[l - 1] / 2 + hGap + widest[l] / 2

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
  layers.forEach(stack)

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
    // 先頭に引っ張られて列全体が下へずれていかないよう、希望位置の中心に合わせ直す
    const drift = col.reduce((sum, id, i) => sum + ((y.get(id) ?? 0) - want[i]), 0) / (col.length || 1)
    for (const id of col) y.set(id, (y.get(id) ?? 0) - drift)
  }
  for (let pass = 0; pass < 4; pass++) {
    for (let l = maxLayer - 1; l >= 0; l--) pullToward(layers[l], outs)
    for (let l = 1; l <= maxLayer; l++) pullToward(layers[l], ins)
  }

  // 寄せた結果できた大きな空きは詰める。相手の正面に置こうとするあまり
  // 列の途中が大きく空くと、全体を映したときに縮みすぎて読めなくなる。
  const compact = (col: string[]) => {
    let prevBottom: number | null = null
    let prevClass: string | null = null
    for (const id of col) {
      const h = size.get(id)?.h ?? 36
      const cls = classOf.get(id)!
      const gap = prevClass !== null && cls !== prevClass ? vGap + classGap : vGap
      const top = (y.get(id) ?? 0) - h / 2
      if (prevBottom !== null && top > prevBottom + gap * 3) y.set(id, prevBottom + gap * 3 + h / 2)
      prevBottom = (y.get(id) ?? 0) - h / 2 + h
      prevClass = cls
    }
  }
  layers.forEach(compact)

  // 全体を上端0に寄せる
  const tops = ids.map((id) => (y.get(id) ?? 0) - (size.get(id)?.h ?? 36) / 2)
  const offset = tops.length > 0 ? Math.min(...tops) : 0

  const placed = new Map<string, PlacedNode>()
  for (let l = 0; l <= maxLayer; l++) {
    for (const id of layers[l]) placed.set(id, { x: colCenter[l], y: (y.get(id) ?? 0) - offset, layer: l })
  }
  return placed
}
