// 整理用グループと並び順のユーティリティ（クライアント・サーバ共用）。
//
// 並び順の方針: order は「密な連番」ではなく ORDER_STEP 刻みの疎な値として持つ。
// ドラッグで1件動かしたときは前後の中間値を計算し、動いた1件だけを書き込む。
// 全件に 0,1,2… を振り直す方式だと1回のドラッグで件数分の更新が走るため採らない。

import type { OntologyGroup, OrganizableFields } from "./types"

export const ORDER_STEP = 1000

// 未分類（グループ未設定）を表す UI 上のキー。groupId には保存しない。
export const UNGROUPED = "__ungrouped__" as const

type Sortable = OrganizableFields & { id: string; createdAt?: string }

// order 未設定の既存データは末尾に回し、同値は createdAt → id で安定させる。
export function compareByOrder(a: Sortable, b: Sortable): number {
  const ao = a.order ?? Number.MAX_SAFE_INTEGER
  const bo = b.order ?? Number.MAX_SAFE_INTEGER
  if (ao !== bo) return ao - bo
  const ac = a.createdAt ?? ""
  const bc = b.createdAt ?? ""
  if (ac !== bc) return ac < bc ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function sortByOrder<T extends Sortable>(items: T[]): T[] {
  return [...items].sort(compareByOrder)
}

// グループ自身の並び順
export function sortGroups(groups: OntologyGroup[]): OntologyGroup[] {
  return [...groups].sort((a, b) => (a.order - b.order) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

// 所属グループごとに仕分けする。未設定・既に存在しないグループを指すものは未分類へ。
export function groupItems<T extends Sortable>(
  items: T[],
  groups: OntologyGroup[],
): { group: OntologyGroup | null; items: T[] }[] {
  const known = new Set(groups.map((g) => g.id))
  const buckets = new Map<string, T[]>()
  for (const item of items) {
    const key = item.groupId && known.has(item.groupId) ? item.groupId : UNGROUPED
    const bucket = buckets.get(key)
    if (bucket) bucket.push(item)
    else buckets.set(key, [item])
  }
  const sections: { group: OntologyGroup | null; items: T[] }[] = sortGroups(groups).map((group) => ({
    group,
    items: sortByOrder(buckets.get(group.id) ?? []),
  }))
  // 未分類は常に最後に置く（空でも表示側が「未分類」の受け皿として使えるよう返す）
  sections.push({ group: null, items: sortByOrder(buckets.get(UNGROUPED) ?? []) })
  return sections
}

// 新しく末尾に足すときの order
export function nextOrder(items: { order?: number }[]): number {
  const max = items.reduce((m, i) => (i.order !== undefined && i.order > m ? i.order : m), 0)
  return max + ORDER_STEP
}

// 並び替え先の order を求める。prev / next は移動先の前後にある要素（無ければ undefined）。
// 中間値が取れない（隙間が尽きた）場合は null を返し、呼び出し側でそのグループを振り直す。
export function orderBetween(prev?: { order?: number }, next?: { order?: number }): number | null {
  const before = prev?.order
  const after = next?.order
  if (before === undefined && after === undefined) return ORDER_STEP
  if (before === undefined) return (after as number) - ORDER_STEP
  if (after === undefined) return before + ORDER_STEP
  if (after - before < 2) return null
  return Math.floor((before + after) / 2)
}

// 隙間が尽きたグループを ORDER_STEP 刻みで振り直す（この並びのまま採番する）
export function renumber<T extends Sortable>(ordered: T[]): { id: string; order: number }[] {
  return ordered.map((item, index) => ({ id: item.id, order: (index + 1) * ORDER_STEP }))
}
