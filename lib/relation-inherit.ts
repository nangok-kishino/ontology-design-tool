// 子クラスは、親クラスに定義されたリレーションを自動的に継承する。
//
// リレーションの始点・終点（classPairs）には親クラスだけを書く。子クラスを
// ひとつずつ書き出す必要はないし、書き出してもいけない。書き出してしまうと、
// 子クラスを作り直すたびに参照先を失ったペアが残り、「不明」の端点を掃除する
// 作業が増えるだけになる。継承は保存の形ではなく、照合のときに効かせる。
//
//   宣言 : 設備 --[設置される]--> 場所
//   照合 : ポンプA〈遠心ポンプ〉 → 工場B〈屋内〉 も成立する
//          （遠心ポンプ は 設備 の子、屋内 は 場所 の子）
//
// トリプレットの型チェック・述語や目的語の絞り込みは relationAllowsPair を通す。
// 保存と表示は normalizeClassPairs を通す。

import type { ClassPair, OntologyRelation } from "./types"

// 親子関係さえ分かれば判定できるので、クラス全体ではなくこの形だけを要求する
export type ClassLike = { id: string; parentId?: string | null }

export function classMap(classes: ClassLike[]): Map<string, ClassLike> {
  return new Map(classes.map((c) => [c.id, c]))
}

// descendantId が ancestorId 自身か、その子孫か。
// データが壊れて親子が循環していても止まるようにしている。
export function isSelfOrDescendant(
  descendantId: string | null | undefined,
  ancestorId: string | null | undefined,
  byId: Map<string, ClassLike>,
): boolean {
  if (!descendantId || !ancestorId) return false
  let current: string | null | undefined = descendantId
  const seen = new Set<string>()
  while (current && !seen.has(current)) {
    if (current === ancestorId) return true
    seen.add(current)
    current = byId.get(current)?.parentId ?? null
  }
  return false
}

// ペア（親クラスでの宣言）が、この (始点, 終点) の組み合わせを許すか
export function pairAllows(
  pair: ClassPair,
  sourceClassId: string | null | undefined,
  targetClassId: string | null | undefined,
  byId: Map<string, ClassLike>,
): boolean {
  return (
    isSelfOrDescendant(sourceClassId, pair.sourceClassId, byId) &&
    isSelfOrDescendant(targetClassId, pair.targetClassId, byId)
  )
}

// リレーションがこの (始点, 終点) を許すか。子クラスは親の宣言で通る。
export function relationAllowsPair(
  relation: Pick<OntologyRelation, "classPairs">,
  sourceClassId: string | null | undefined,
  targetClassId: string | null | undefined,
  classes: ClassLike[] | Map<string, ClassLike>,
): boolean {
  if (!sourceClassId || !targetClassId) return false
  const byId = classes instanceof Map ? classes : classMap(classes)
  return (relation.classPairs ?? []).some((p) => pairAllows(p, sourceClassId, targetClassId, byId))
}

// 保存・表示の前にペアを整える。
//   - 同じペアの重複を落とす
//   - 参照先クラスが存在しないペアを落とす（消えた子クラスの「不明」を残さない）
//   - 親のペアで説明できるペアを落とす（かつて展開された子クラス分を畳む）
// クラス一覧が空＝まだ取得できていないときは、判断材料が無いので何もしない。
export function normalizeClassPairs(
  pairs: ClassPair[] | undefined,
  classes: ClassLike[],
): ClassPair[] {
  const list = pairs ?? []
  if (classes.length === 0 || list.length === 0) return list
  const byId = classMap(classes)

  const seen = new Set<string>()
  const alive: ClassPair[] = []
  for (const p of list) {
    if (!byId.has(p.sourceClassId) || !byId.has(p.targetClassId)) continue
    const key = `${p.sourceClassId}|${p.targetClassId}`
    if (seen.has(key)) continue
    seen.add(key)
    alive.push(p)
  }
  // 重複を除いた後なので、2つのペアが互いを説明し合うことはない（同一ペアのみ）
  return alive.filter((p) => !alive.some((q) => q !== p && pairAllows(q, p.sourceClassId, p.targetClassId, byId)))
}
