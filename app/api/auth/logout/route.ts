import { NextResponse } from "next/server"

export async function POST() {
  const response = NextResponse.json({ ok: true })
  response.cookies.delete("auth-session")
  response.cookies.delete("user-email")
  return response
}
