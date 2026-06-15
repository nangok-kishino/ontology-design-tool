import type { NextRequest } from "next/server"

// Azure SWA の x-ms-client-principal ヘッダーから Entra ID の表示名を取得する
// 本番 SWA では Entra ID の name クレーム → userDetails (email) の順で返す
// ローカル dev や未認証時は fallback を返す
export function getPrincipalName(request: NextRequest, fallback = ""): string {
  const encoded = request.headers.get("x-ms-client-principal")
  if (encoded) {
    try {
      const principal = JSON.parse(Buffer.from(encoded, "base64").toString("utf-8"))
      const name = (principal.claims as Array<{ typ: string; val: string }> | undefined)
        ?.find((c) => c.typ === "name")?.val
      if (name) return name
      if (principal.userDetails) return principal.userDetails
    } catch { /* デコード失敗は無視 */ }
  }
  return request.headers.get("x-ms-client-principal-name") ?? fallback
}
