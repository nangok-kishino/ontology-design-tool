// マインドマップの座標計算。
//
// 中心に根を置き、子を左右に振り分けて、それぞれを横方向のツリーとして並べる。
// 同じ段のノードは同じ列に揃い、子は親の右（左側の枝なら左）へ縦に積まれる。
// 子が40個あっても縦に40行並ぶだけなので、名前は重ならない。
//
//        ┌ 子
//   根 ──┤
//        └ 子 ── 孫
//
// 向きは当てにしない（「AはBを構成部品に持つ」は親→子、「AはBに属する」は
// 子→親なので、辺の向きだけでは上下が決まらない）。無向グラフとして扱い、
// 連結成分ごとに次数が最大のノードを根に選んで幅優先で木を張る。
// 木に入らなかった辺（横の繋がりや循環）は、描画側で点線として残す。

export type LayoutEdge = { source: string; target: string }

// 配置にはカードの実寸が要る（幅で列の間隔、高さで行の間隔が決まる）
export type SizedNode = { id: string; w: number; h: number }

export type PlacedNode = {
  x: number
  y: number
  // 根からの段数（根は0）
  depth: number
  // 根から見てどちら側の枝か（根自身は0）
  side: -1 | 0 | 1
  parentId: string | null
}

export type MindMapOptions = {
  // 列と列の間隔
  hGap?: number
  // 行と行の間隔
  vGap?: number
  // 連結成分どうしの間隔
  componentGap?: number
}

type Tree = {
  root: string
  parent: Map<string, string | null>
  children: Map<string, string[]>
  depth: Map<string, number>
}

// 連結成分ごとに、次数が最大のノードを根として幅優先で木を張る
function spanningTrees(nodeIds: string[], adjacency: Map<string, Set<string>>): Tree[] {
  const seen = new Set<string>()
  const trees: Tree[] = []
  // 大きい成分から先に置くと、縦に並べたときの座りが良い
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
      for (const child of [...(adjacency.get(id) ?? [])].sort()) {
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

// 葉の数。左右の振り分けで釣り合いを取るのに使う。
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

export function mindMapLayout(
  nodes: SizedNode[],
  edges: LayoutEdge[],
  options: MindMapOptions = {},
): Map<string, PlacedNode> {
  const hGap = options.hGap ?? 170
  const vGap = options.vGap ?? 14
  const componentGap = options.componentGap ?? 90

  const size = new Map(nodes.map((n) => [n.id, { w: n.w, h: n.h }]))
  const nodeIds = nodes.map((n) => n.id)
  const adjacency = new Map<string, Set<string>>()
  for (const id of nodeIds) adjacency.set(id, new Set())
  for (const e of edges) {
    if (e.source === e.target) continue
    adjacency.get(e.source)?.add(e.target)
    adjacency.get(e.target)?.add(e.source)
  }

  const placed = new Map<string, PlacedNode>()
  let offsetY = 0

  for (const tree of spanningTrees(nodeIds, adjacency)) {
    const leaves = leafCounts(tree)
    const local = new Map<string, PlacedNode>()

    // 根の子を左右へ振り分ける。葉の多い枝から、軽い側へ置いていく。
    const rootKids = tree.children.get(tree.root) ?? []
    const sideOf = new Map<string, 1 | -1>()
    let rightLoad = 0
    let leftLoad = 0
    for (const kid of [...rootKids].sort((a, b) => (leaves.get(b) ?? 1) - (leaves.get(a) ?? 1))) {
      const n = leaves.get(kid) ?? 1
      if (rightLoad <= leftLoad) {
        sideOf.set(kid, 1)
        rightLoad += n
      } else {
        sideOf.set(kid, -1)
        leftLoad += n
      }
    }

    // 段ごとの列の中心（その段でいちばん広いカードに合わせる）
    const widest = new Map<number, number>()
    for (const [id, d] of tree.depth) widest.set(d, Math.max(widest.get(d) ?? 0, size.get(id)?.w ?? 80))
    const maxDepth = Math.max(0, ...tree.depth.values())
    const colCenter: number[] = [0]
    for (let d = 1; d <= maxDepth; d++) {
      colCenter[d] = colCenter[d - 1] + (widest.get(d - 1) ?? 0) / 2 + hGap + (widest.get(d) ?? 0) / 2
    }

    // 片側ぶんを縦に積む。葉を上から順に置き、親は子の真ん中に来る。
    const layoutSide = (roots: string[], side: 1 | -1): string[] => {
      const ids: string[] = []
      let cursor = 0
      const place = (id: string): number => {
        const depth = tree.depth.get(id) ?? 0
        const h = size.get(id)?.h ?? 28
        const kids = tree.children.get(id) ?? []
        let y: number
        if (kids.length === 0) {
          y = cursor + h / 2
          cursor += h + vGap
        } else {
          const ys = kids.map(place)
          y = (ys[0] + ys[ys.length - 1]) / 2
        }
        local.set(id, { x: side * colCenter[depth], y, depth, side, parentId: tree.parent.get(id) ?? null })
        ids.push(id)
        return y
      }
      for (const r of roots) place(r)
      return ids
    }

    // 左右それぞれを縦の中央で揃える
    for (const side of [1, -1] as const) {
      const ids = layoutSide(
        rootKids.filter((k) => (sideOf.get(k) ?? 1) === side),
        side,
      )
      if (ids.length === 0) continue
      const ys = ids.map((id) => local.get(id)!.y)
      const mid = (Math.min(...ys) + Math.max(...ys)) / 2
      for (const id of ids) {
        const p = local.get(id)!
        local.set(id, { ...p, y: p.y - mid })
      }
    }
    local.set(tree.root, { x: 0, y: 0, depth: 0, side: 0, parentId: null })

    // 成分を縦に積む
    const tops = [...local.entries()].map(([id, p]) => p.y - (size.get(id)?.h ?? 28) / 2)
    const bottoms = [...local.entries()].map(([id, p]) => p.y + (size.get(id)?.h ?? 28) / 2)
    const shift = offsetY - Math.min(...tops)
    for (const [id, p] of local) placed.set(id, { ...p, y: p.y + shift })
    offsetY = Math.max(...bottoms) + shift + componentGap
  }

  return placed
}
