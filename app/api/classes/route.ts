import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import type { OntologyClass } from "@/lib/types"

const CONTAINER = "classes"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get("projectId")
    const container = await getContainer(CONTAINER)

    if (projectId) {
      const { resources } = await container.items
        .query<OntologyClass>({
          query: "SELECT * FROM c WHERE c.projectId = @projectId",
          parameters: [{ name: "@projectId", value: projectId }],
        })
        .fetchAll()
      return NextResponse.json(resources)
    }

    const { resources } = await container.items.readAll<OntologyClass>().fetchAll()
    return NextResponse.json(resources)
  } catch (error) {
    console.error("GET /api/classes:", error)
    return NextResponse.json({ error: "クラス一覧の取得に失敗しました" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const now = new Date().toISOString()
    const item: OntologyClass = {
      id: crypto.randomUUID(),
      projectId: body.projectId,
      name: body.name,
      description: body.description ?? "",
      parentId: body.parentId ?? null,
      createdAt: now,
      updatedAt: now,
    }
    const container = await getContainer(CONTAINER)
    const { resource } = await container.items.create(item)
    return NextResponse.json(resource, { status: 201 })
  } catch (error) {
    console.error("POST /api/classes:", error)
    return NextResponse.json({ error: "クラスの作成に失敗しました" }, { status: 500 })
  }
}
