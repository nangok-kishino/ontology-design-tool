import type { NextRequest } from "next/server"

// ログイン時に入力されたメールアドレスを取得する（app/api/auth/login で Cookie に保存）
// 未ログイン・Cookie未設定時は fallback を返す
export function getPrincipalName(request: NextRequest, fallback = ""): string {
  const encoded = request.cookies.get("user-email")?.value
  if (!encoded) return fallback
  try {
    return decodeURIComponent(encoded)
  } catch {
    return fallback
  }
}
