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
