// グラフ描画（グラフビュー／スキーマビュー）で共通に使うクラス色の計算。
//   同じ classId は両ビューで同じ色になるよう、色相は classId 文字列から決定的に作る。

// classId 文字列から決定的に色相(hue)を作る。暗背景で映えるネオン色に使う。
export function hueForClass(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return h % 360
}
export const NO_CLASS_HUE = 190 // 未分類はシアン寄り

// HSL(彩度85%/明度63%固定) → "rgba(r,g,b,a)"。canvas でのエッジ/粒の色に使う
// （hsla の slash 記法は canvas 実装差があるため rgb に変換して確実に描画する）。
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))]
}
export function neon(hue: number, alpha: number): string {
  const [r, g, b] = hslToRgb(hue, 0.85, 0.63)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// ツールチップ HTML 用のエスケープ
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

// クラスやリレーションに配る色相。id のハッシュだと近い色が隣り合って
// 区別できないことがあるので、見分けのつく色相を出てくる順に配る。
// 一巡したら少しずらして、同じ色が続けて出ないようにする。
const PALETTE_HUES = [210, 25, 145, 275, 340, 190, 50, 300, 10, 165, 250, 95]

// startIndex は配り始めの位置。クラスとリレーションで色が被らないよう、
// リレーション側はパレットの半分ずらした所から配る。
export function buildHueMap(ids: string[], startIndex = 0): Map<string, number> {
  const map = new Map<string, number>()
  ids.forEach((id, i) => {
    const n = i + startIndex
    const round = Math.floor(n / PALETTE_HUES.length)
    map.set(id, (PALETTE_HUES[n % PALETTE_HUES.length] + round * 17) % 360)
  })
  return map
}

// 暗い背景に置くカードの色。塗りは暗く、縁と見出しだけ色を効かせる。
// 彩度の高い塗りを並べると画面が騒がしくなるので、色は「どのクラスか」を
// 示すだけに留める。
export function cardFill(hue: number): string {
  return `hsl(${hue}, 22%, 15%)`
}
export function cardBorder(hue: number, strong = false): string {
  return `hsl(${hue}, ${strong ? 50 : 32}%, ${strong ? 62 : 36}%)`
}
export function cardAccent(hue: number): string {
  return `hsl(${hue}, 42%, 68%)`
}
// 線の色。ネオンほど主張させない。
export function line(hue: number, alpha: number): string {
  const [r, g, b] = hslToRgb(hue, 0.45, 0.62)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
