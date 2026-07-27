// 名寄せ（エンティティ・レゾリューション）用の文字列正規化
//
// 目的: 表記揺れを吸収した「照合キー」を生成する。ここで生成した値は
//   - インスタンスの normalizedName として保存し、
//   - 名寄せチェックのブロッキングキー（候補検出の第一段）として使う。
//
// 重要: 正規化はあくまで「一致候補」を検出するための手がかりであり、
// 統合を確定する操作ではない。正規化後に一致しても自動統合は行わず、
// 必ず人の承認を経る（名寄せ設計の原則A）。このため、多少強めに揺れを
// 吸収して誤検出（＝候補）が増えても、最終判断は人が行うので安全側に倒せる。

// NFKC で吸収されるもの: 全角英数字→半角、半角カナ→全角カナ、丸数字→数字、
// 互換合成文字の分解・再合成 など。
export function normalizeName(input: string | null | undefined): string {
  if (!input) return ""
  let s = input.normalize("NFKC")

  // 英字の大文字・小文字差を吸収
  s = s.toLowerCase()

  // 空白の除去（NFKC で全角スペースは半角化済み。前後・中間すべて除去）
  s = s.replace(/\s+/g, "")

  // 区切り記号・装飾記号の揺れを除去
  s = s.replace(/[・･]/g, "") // 中黒
  s = s.replace(/[-−–—―ｰー~〜]/g, "") // 各種ハイフン・長音・波ダッシュ
  s = s.replace(/[／/＼\\]/g, "") // スラッシュ・バックスラッシュ
  s = s.replace(/[（）()「」『』［］\[\]【】｛｝{}〈〉《》]/g, "") // 各種括弧
  s = s.replace(/[､、，,]/g, "") // 読点・カンマ
  s = s.replace(/[｡。]/g, "") // 句点（小数点 "." は意味を持ちうるため残す）
  s = s.replace(/[　]/g, "") // 念のため全角スペース

  return s
}

// 表示や辞書登録の前段として、余分な空白のみを整える軽い整形。
// normalizeName と違い、人が読む値（name そのもの）を壊さない。
export function trimName(input: string | null | undefined): string {
  if (!input) return ""
  return input.trim().replace(/\s+/g, " ")
}
