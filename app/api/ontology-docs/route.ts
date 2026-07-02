import { NextResponse } from "next/server"
import fs from "fs/promises"
import path from "path"

const DOCS_DIR = path.join(process.cwd(), "public", "ontology-docs")

export async function GET() {
  try {
    const files = await fs.readdir(DOCS_DIR)
    const htmlFiles = files
      .filter((f) => f.toLowerCase().endsWith(".html"))
      .sort((a, b) => a.localeCompare(b, "ja"))
    return NextResponse.json(htmlFiles)
  } catch (error) {
    console.error("GET /api/ontology-docs:", error)
    return NextResponse.json({ error: "ドキュメント一覧の取得に失敗しました" }, { status: 500 })
  }
}
