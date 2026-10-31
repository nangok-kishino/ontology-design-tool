// 放射状ツリー（マインドマップ）の座標計算。
//
// 力学グラフは、ひとつのノードに子が何十個もぶら下がる形――商品の構成のような
// 階層――を苦手とする。リンク距離が一定なので子が同じ半径に密集し、名前も
// エッジ名も中心付近で重なって読めなくなる。
//
// ここでは階層を見つけて決め打ちで配置する：
//   根を中心に置き、子は葉の数に応じた扇形を分け合って外周に並ぶ。
//   外周の半径はその階層のノード数から決めるので、子が増えれば輪が大きくなり、
//   隣との間隔は保たれる。
//
// 向きは当てにしない（「AはBを構成部品に持つ」は親→子、「AはBに属する」は
// 子→親なので、辺の向きだけでは上下が決まらない）。無向グラフとして扱い、
// 連結成分ごとに次数が最大のノードを根に選んで幅優先で木を張る。
// 木に入らなかった辺（横の繋がりや循環）は、描画側でそのまま線として残る。

export type LayoutEdge = { source: string; target: string }

export type PlacedNode = {
  x: number
  y: number
  // 根からの段数（根は0）
  depth: number
  // 中心から見た向き（ラジアン）。ラベルを外向きに置くのに使う。
  angle: number
  parentId: string | null
}

export type RadialLayoutOptions = {
  // 隣り合う輪の最小間隔
  ringGap?: number
  // 同じ輪に並ぶノード同士の最小間隔（これを満たすように輪を大きくする）
  nodeSpacing?: number
  // 連結成分どうしの間隔
  componentGap?: number
}

type Tree = { root: string; parent: Map<string, string | null>; children: Map<string, string[]>; depth: Map<string, number> }

// 連結成分ごとに、次数が最大のノードを根として幅優先で木を張る
function spanningTrees(nodeIds: string[], adjacency: Map<string, Set<string>>): Tree[] {
  const seen = new Set<string>()
  const trees: Tree[] = []
  // 大きい成分から先に置くと、横並びにしたときの座りが良い
  const order = [...nodeIds].sort(
    (a, b) => (adjacency.get(b)?.size ?? 0) - (adjacency.get(a)?.size ?? 0) || a.localeCompare(b),
  )
  for (const start of order) {
    if (seen.has(start)) continue
    const parent = new Map<string, string | null>([[start, null]])
    const children = new Map<string, string[]>()
    const depth = new Map<string, number>([[start, 0]])
    seen.add(start)
    const queue = [start]
    while (queue.length > 0) {
      const id = queue.shift()!
      const next = [...(adjacency.get(id) ?? [])].sort()
      for (const child of next) {
        if (seen.has(child)) continue
        seen.add(child)
        parent.set(child, id)
        depth.set(child, (depth.get(id) ?? 0) + 1)
        children.set(id, [...(children.get(id) ?? []), child])
        queue.push(child)
      }
    }
    trees.push({ root: start, parent, children, depth })
  }
  return trees
}

// 葉の数（扇形の取り分）。子を持たないノードは1。
function leafCounts(tree: Tree): Map<string, number> {
  const counts = new Map<string, number>()
  const visit = (id: string): number => {
    const kids = tree.children.get(id) ?? []
    const n = kids.length === 0 ? 1 : kids.reduce((sum, k) => sum + visit(k), 0)
    counts.set(id, n)
    return n
  }
  visit(tree.root)
  return counts
}

export function radialTreeLayout(
  nodeIds: string[],
  edges: LayoutEdge[],
  options: RadialLayoutOptions = {},
): Map<string, PlacedNode> {
  const ringGap = options.ringGap ?? 150
  const nodeSpacing = options.nodeSpacing ?? 90
  const componentGap = options.componentGap ?? 260

  const adjacency = new Map<string, Set<string>>()
  for (const id of nodeIds) adjacency.set(id, new Set())
  for (const e of edges) {
    if (e.source === e.target) continue
    adjacency.get(e.source)?.add(e.target)
    adjacency.get(e.target)?.add(e.source)
  }

  const placed = new Map<string, PlacedNode>()
  let offsetX = 0

  for (const tree of spanningTrees(nodeIds, adjacency)) {
    const counts = leafCounts(tree)

    // 段ごとのノード数から、その輪の半径を決める。
    // 円周に nodeSpacing × 件数 が収まる大きさを確保する。
    const perDepth = new Map<number, number>()
    for (const d of tree.depth.values()) perDepth.set(d, (perDepth.get(d) ?? 0) + 1)
    const maxDepth = Math.max(0, ...perDepth.keys())
    const radii: number[] = [0]
    for (let d = 1; d <= maxDepth; d++) {
      const needed = ((perDepth.get(d) ?? 1) * nodeSpacing) / (2 * Math.PI)
      radii[d] = Math.max(radii[d - 1] + ringGap, needed)
    }

    // 扇形を子へ配り、その中央にノードを置く
    const local = new Map<string, PlacedNode>()
    const assign = (id: string, from: number, to: number) => {
      const depth = tree.depth.get(id) ?? 0
      const angle = (from + to) / 2
      const r = radii[depth] ?? 0
      local.set(id, {
        x: r * Math.cos(angle),
        y: r * Math.sin(angle),
        depth,
        angle,
        parentId: tree.parent.get(id) ?? null,
      })
      const kids = tree.children.get(id) ?? []
      if (kids.length === 0) return
      const total = kids.reduce((sum, k) => sum + (counts.get(k) ?? 1), 0) || 1
      let cursor = from
      for (const kid of kids) {
        const share = ((counts.get(kid) ?? 1) / total) * (to - from)
        assign(kid, cursor, cursor + share)
        cursor += share
      }
    }
    // 根は全周を使う。根自身は中心（角度は右向きを既定とする）。
    assign(tree.root, 0, 2 * Math.PI)
    local.set(tree.root, { ...local.get(tree.root)!, x: 0, y: 0, angle: 0 })

    // 成分を横に並べる
    const xs = [...local.values()].map((p) => p.x)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const shift = offsetX - minX
    for (const [id, p] of local) placed.set(id, { ...p, x: p.x + shift })
    offsetX = shift + maxX + componentGap
  }

  return placed
}
