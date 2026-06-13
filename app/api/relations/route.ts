import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import type { OntologyRelation } from "@/lib/types"

const CONTAINER = "relations"

export async function GET() {
  try {
    const container = await getContainer(CONTAINER)
    const { resources } = await container.items.readAll<OntologyRelation>().fetchAll()
    return NextResponse.json(resources)
  } catch (error) {
    console.error("GET /api/relations:", error)
    return NextResponse.json({ error: "リレーション一覧の取得に失敗しました" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const now = new Date().toISOString()
    const item: OntologyRelation = {
      id: crypto.randomUUID(),
      name: body.name,
      description: body.description ?? "",
      sourceClassId: body.sourceClassId,
      targetClassId: body.targetClassId,
      parentRelationId: body.parentRelationId ?? null,
      createdAt: now,
      updatedAt: now,
    }
    const container = await getContainer(CONTAINER)
    const { resource } = await container.items.create(item)
    return NextResponse.json(resource, { status: 201 })
  } catch (error) {
    console.error("POST /api/relations:", error)
    return NextResponse.json({ error: "リレーションの作成に失敗しました" }, { status: 500 })
  }
}
