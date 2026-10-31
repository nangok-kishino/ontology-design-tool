// クラスの並べ方。クラス管理の一覧／ボードと、インスタンス管理の左ペインで
// 同じ順序になるよう、ここに一本化する。
//
// 並びは「グループ → そのグループの根クラス（order 順）→ 配下のサブクラス（order 順）」。
// サブクラスのグループは親（根）に従う（lib/organize.ts の rootOf 参照）ので、
// ひとつの木がグループをまたいで分断されることはない。

import { UNGROUPED, rootOf, sortByOrder, sortGroups } from "./organize"
import type { OntologyClass, OntologyGroup } from "./types"

export type ClassTreeNode = OntologyClass & { children: ClassTreeNode[] }

export function buildClassTree(items: OntologyClass[]): ClassTreeNode[] {
  const map = new Map(items.map((c) => [c.id, { ...c, children: [] as ClassTreeNode[] }]))
  const roots: ClassTreeNode[] = []
  for (const node of map.values()) {
    if (node.parentId && map.has(node.parentId)) map.get(node.parentId)!.children.push(node)
    else roots.push(node)
  }
  return roots
}

// きょうだい同士を order で並べる（深さを問わず同じ規則）
export function sortClassTree(nodes: ClassTreeNode[]): ClassTreeNode[] {
  return sortByOrder(nodes).map((n) => ({ ...n, children: sortClassTree(n.children) }))
}

export type ClassSection = { group: OntologyGroup | null; trees: ClassTreeNode[] }

// グループごとに仕分けた木。未分類（group: null）は最後に置く。
export function classSections(classes: OntologyClass[], groups: OntologyGroup[]): ClassSection[] {
  const known = new Set(groups.map((g) => g.id))
  const byId = new Map(classes.map((c) => [c.id, c]))
  const buckets = new Map<string, OntologyClass[]>()
  for (const c of classes) {
    const gid = rootOf(c, byId).groupId ?? null
    const key = gid && known.has(gid) ? gid : UNGROUPED
    const list = buckets.get(key)
    if (list) list.push(c)
    else buckets.set(key, [c])
  }
  const build = (group: OntologyGroup | null, list: OntologyClass[]): ClassSection => ({
    group,
    trees: sortClassTree(buildClassTree(list)),
  })
  return [
    ...sortGroups(groups).map((g) => build(g, buckets.get(g.id) ?? [])),
    build(null, buckets.get(UNGROUPED) ?? []),
  ]
}

// グループの区切りを無視して、表示順に並べた根クラスだけを得る
export function orderedClassRoots(classes: OntologyClass[], groups: OntologyGroup[]): ClassTreeNode[] {
  return classSections(classes, groups).flatMap((s) => s.trees)
}
