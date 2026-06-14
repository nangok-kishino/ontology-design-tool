import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import type { Project } from "@/lib/types"

const CONTAINER = "projects"

export async function GET() {
  try {
    const container = await getContainer(CONTAINER)
    const { resources } = await container.items.readAll<Project>().fetchAll()
    return NextResponse.json(resources)
  } catch (error) {
    console.error("GET /api/projects:", error)
    return NextResponse.json({ error: "プロジェクト一覧の取得に失敗しました" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const now = new Date().toISOString()
    const item: Project = {
      id: crypto.randomUUID(),
      name: body.name,
      description: body.description ?? "",
      createdAt: now,
      updatedAt: now,
    }
    const container = await getContainer(CONTAINER)
    const { resource } = await container.items.create(item)
    return NextResponse.json(resource, { status: 201 })
  } catch (error) {
    console.error("POST /api/projects:", error)
    return NextResponse.json({ error: "プロジェクトの作成に失敗しました" }, { status: 500 })
  }
}
