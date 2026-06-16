import { NextResponse } from "next/server"

export async function GET() {
  try {
    const res = await fetch("https://api.ipify.org?format=json")
    const data = await res.json()
    const geminiKey = process.env.GEMINI_API_KEY
    return NextResponse.json({
      outboundIp: data.ip,
      geminiKeySet: !!geminiKey,
      geminiKeyPrefix: geminiKey?.slice(0, 8) ?? "(unset)",
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
