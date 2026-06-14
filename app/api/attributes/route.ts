import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import type { OntologyAttribute } from "@/lib/types"

const CONTAINER = "attributes"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const targetId = searchParams.get("targetId")
    const container = await getContainer(CONTAINER)

    if (targetId) {
      const { resources } = await container.items
        .query<OntologyAttribute>({
          query: "SELECT * FROM c WHERE c.targetId = @targetId",
          parameters: [{ name: "@targetId", value: targetId }],
        })
        .fetchAll()
      return NextResponse.json(resources)
    }

    const { resources } = await container.items.readAll<OntologyAttribute>().fetchAll()
    return NextResponse.json(resources)
  } catch (error) {
    console.error("GET /api/attributes:", error)
    return NextResponse.json({ error: "属性一覧の取得に失敗しました" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const now = new Date().toISOString()
    const item: OntologyAttribute = {
      id: crypto.randomUUID(),
      projectId: body.projectId,
      name: body.name,
      dataType: body.dataType,
      required: body.required ?? "任意",
      scope: body.scope ?? "固有",
      targetId: body.targetId,
      targetType: body.targetType,
      createdAt: now,
      updatedAt: now,
    }
    const container = await getContainer(CONTAINER)
    const { resource } = await container.items.create(item)
    return NextResponse.json(resource, { status: 201 })
  } catch (error) {
    console.error("POST /api/attributes:", error)
    return NextResponse.json({ error: "属性の作成に失敗しました" }, { status: 500 })
  }
}
