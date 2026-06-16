import { NextRequest, NextResponse } from "next/server"

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname.startsWith("/login") || pathname.startsWith("/api/auth/")) {
    return NextResponse.next()
  }

  const session = request.cookies.get("auth-session")?.value
  if (session && session === process.env.AUTH_TOKEN) {
    return NextResponse.next()
  }

  return NextResponse.redirect(new URL("/login", request.url))
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
