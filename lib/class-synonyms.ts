// クラスの同義語（文書中でそのクラスを指す別の呼び方）の整形と重複チェック。
//   例：商品クラスの同義語「製品」→ 文書の「製品名：アクトチェア」を商品のインスタンスとして読み替える。
//   照合は lib/normalize.ts の normalizeName（表記揺れを吸収したキー）で行う。

import { normalizeName } from "@/lib/normalize"
import type { OntologyClass } from "@/lib/types"

// 入力された同義語を整える：前後空白除去・空要素除去・正規化一致の重複除去・自クラス名と同じものの除去
export function cleanSynonyms(input: unknown, ownName: string): string[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>([normalizeName(ownName)])
  const out: string[] = []
  for (const raw of input) {
    if (typeof raw !== "string") continue
    const s = raw.trim()
    const key = normalizeName(s)
    if (!s || !key || seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out
}

// 同じ語が2つのクラスを指さないかを確認する。重複があればエラーメッセージを返す。
//   - 同義語が、他クラスのクラス名・同義語と一致しないこと
//   - クラス名が、他クラスの同義語と一致しないこと
//   （クラス名同士の重複は従来どおりここでは扱わない）
// 照合に使うのは id・name・synonyms だけなので、呼び出し側は
// その3列だけを取得したクラスを渡してよい（全列を読む必要はない）。
export type ClassForSynonymCheck = Pick<OntologyClass, "id" | "name" | "synonyms">

export function findSynonymConflict(
  classes: ClassForSynonymCheck[],
  selfId: string | null,
  name: string,
  synonyms: string[],
): string | null {
  const others = classes.filter((c) => c.id !== selfId)
  const nameOwner = new Map<string, ClassForSynonymCheck>()
  const synonymOwner = new Map<string, ClassForSynonymCheck>()
  for (const c of others) {
    nameOwner.set(normalizeName(c.name), c)
    for (const s of c.synonyms ?? []) synonymOwner.set(normalizeName(s), c)
  }
  for (const s of synonyms) {
    const key = normalizeName(s)
    const byName = nameOwner.get(key)
    if (byName) return `同義語「${s}」はクラス「${byName.name}」の名前と同じです`
    const bySyn = synonymOwner.get(key)
    if (bySyn) return `同義語「${s}」はクラス「${bySyn.name}」の同義語として登録済みです`
  }
  const bySyn = synonymOwner.get(normalizeName(name))
  if (bySyn) return `クラス名「${name}」はクラス「${bySyn.name}」の同義語として登録済みです`
  return null
}
