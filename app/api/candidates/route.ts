import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import type { LLMCandidate } from "@/lib/types"

const CONTAINER = "candidates"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get("type")
    const container = await getContainer(CONTAINER)

    if (type) {
      const { resources } = await container.items
        .query<LLMCandidate>({
          query: "SELECT * FROM c WHERE c.type = @type",
          parameters: [{ name: "@type", value: type }],
        })
        .fetchAll()
      return NextResponse.json(resources)
    }

    const { resources } = await container.items.readAll<LLMCandidate>().fetchAll()
    return NextResponse.json(resources)
  } catch (error) {
    console.error("GET /api/candidates:", error)
    return NextResponse.json({ error: "候補一覧の取得に失敗しました" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const now = new Date().toISOString()
    const item: LLMCandidate = {
      id: crypto.randomUUID(),
      projectId: body.projectId,
      type: body.type,
      name: body.name,
      description: body.description ?? "",
      status: "確認中",
      sourceClassName: body.sourceClassName,
      targetClassName: body.targetClassName,
      createdAt: now,
      updatedAt: now,
    }
    const container = await getContainer(CONTAINER)
    const { resource } = await container.items.create(item)
    return NextResponse.json(resource, { status: 201 })
  } catch (error) {
    console.error("POST /api/candidates:", error)
    return NextResponse.json({ error: "候補の作成に失敗しました" }, { status: 500 })
  }
}
