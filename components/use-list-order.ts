"use client"

// ラベル・リレーションシップタイプを、管理画面の一覧と同じ並び（グループの順、その中は手で並べた順）で
// 返す。ほかの画面の一覧や選択肢も、名前順ではなくこの並びに揃えるために使う。
// 管理画面で並べ替えた結果が、どの画面でも同じ順に見えるようにするため。

import { useEffect, useMemo } from "react"
import { useGroups } from "@/components/group-manager"
import { UNGROUPED, sortByOrder, sortGroups } from "@/lib/organize"
import type { GroupTarget, OrganizableFields } from "@/lib/types"

type Orderable = OrganizableFields & { id: string; createdAt?: string }

export type OrderedGroup<T> = { key: string; name: string; color?: string; items: T[] }

export function useListOrder<T extends Orderable>(
  items: T[],
  projectId: string | undefined,
  // ラベルは "class"、リレーションシップタイプは "relation"（グループの保存先が旧モデルと共用のため）
  target: GroupTarget,
  active: boolean | undefined,
): { ordered: T[]; grouped: OrderedGroup<T>[] } {
  const { groups, refresh } = useGroups(projectId, target)
  useEffect(() => {
    if (active && projectId) refresh()
  }, [active, projectId, refresh])

  return useMemo(() => {
    const known = new Set(groups.map((g) => g.id))
    const keyOf = (i: T) => (i.groupId && known.has(i.groupId) ? i.groupId : UNGROUPED)
    const grouped: OrderedGroup<T>[] = []
    const emit = (key: string, name: string, color?: string) => {
      const list = sortByOrder(items.filter((i) => keyOf(i) === key))
      if (list.length > 0) grouped.push({ key, name, color, items: list })
    }
    for (const g of sortGroups(groups)) emit(g.id, g.name, g.color)
    emit(UNGROUPED, "未分類")
    return { ordered: grouped.flatMap((g) => g.items), grouped }
  }, [items, groups])
}
