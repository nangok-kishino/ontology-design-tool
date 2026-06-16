import { NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  const { password } = await request.json()

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
  return response
}
