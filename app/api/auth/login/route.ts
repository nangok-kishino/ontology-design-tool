import { NextRequest, NextResponse } from "next/server"
import { getEmailDomain, parseDomainList } from "@/lib/domain"

export async function POST(request: NextRequest) {
  const { email, password } = await request.json()

  if (!email || typeof email !== "string" || !email.includes("@")) {
    return NextResponse.json({ error: "メールアドレスの形式が正しくありません" }, { status: 400 })
  }

  const allowedLoginDomains = parseDomainList(process.env.ALLOWED_DOMAINS ?? "")
  if (allowedLoginDomains.length > 0 && !allowedLoginDomains.includes(getEmailDomain(email))) {
    return NextResponse.json({ error: "このメールアドレスのドメインではログインできません" }, { status: 403 })
  }

  if (!password || password !== process.env.AUTH_PASSWORD) {
    return NextResponse.json({ error: "パスワードが違います" }, { status: 401 })
  }

  const response = NextResponse.json({ ok: true })
  response.cookies.set("auth-session", process.env.AUTH_TOKEN!, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  })
  response.cookies.set("user-email", email, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  })
  return response
}
