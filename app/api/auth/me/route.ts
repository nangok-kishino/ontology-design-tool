import { NextRequest, NextResponse } from "next/server"
import { getPrincipalName } from "@/lib/auth"

export async function GET(request: NextRequest) {
  return NextResponse.json({ email: getPrincipalName(request) })
}
