// ラベルの同義語（文書中でそのラベルを指す別の呼び方）の整形と重複チェック。
//   例：商品ラベルの同義語「製品」→ 文書の「製品名：アクトチェア」を商品のノードとして読み替える。
//   照合は lib/normalize.ts の normalizeName（表記揺れを吸収したキー）で行う。
//
// 【注意】ここで扱うのは「種類」の言い換えであって、個体の言い換え（GraphNode.aliases）ではない。
//   同義語   : ラベル（種類）に対して、人が設計時に手で登録する
//   別名     : ノード（個体）に対して、名寄せで統合したときに吸収される

import { normalizeName } from "@/lib/normalize"
import type { Label } from "@/lib/graph-types"

// 入力された同義語を整える：前後空白除去・空要素除去・正規化一致の重複除去・自ラベル名と同じものの除去
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

// 照合に使うのは id・name・synonyms だけなので、呼び出し側はその3列だけを取得したラベルを渡してよい。
export type LabelForSynonymCheck = Pick<Label, "id" | "name" | "synonyms">

// 同じ語が2つのラベルを指さないかを確認する。重複があればエラーメッセージを返す。
export function findSynonymConflict(
  labels: LabelForSynonymCheck[],
  selfId: string | null,
  name: string,
  synonyms: string[],
): string | null {
  const others = labels.filter((l) => l.id !== selfId)
  const nameOwner = new Map<string, LabelForSynonymCheck>()
  const synonymOwner = new Map<string, LabelForSynonymCheck>()
  for (const l of others) {
    nameOwner.set(normalizeName(l.name), l)
    for (const s of l.synonyms ?? []) synonymOwner.set(normalizeName(s), l)
  }
  for (const s of synonyms) {
    const key = normalizeName(s)
    const byName = nameOwner.get(key)
    if (byName) return `同義語「${s}」はラベル「${byName.name}」の名前と同じです`
    const bySyn = synonymOwner.get(key)
    if (bySyn) return `同義語「${s}」はラベル「${bySyn.name}」の同義語として登録済みです`
  }
  const bySyn = synonymOwner.get(normalizeName(name))
  if (bySyn) return `ラベル名「${name}」はラベル「${bySyn.name}」の同義語として登録済みです`
  return null
}
