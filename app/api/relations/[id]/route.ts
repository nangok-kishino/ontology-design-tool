import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import type { OntologyRelation } from "@/lib/types"

const CONTAINER = "relations"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const container = await getContainer(CONTAINER)
    const { resource } = await container.item(id, id).read<OntologyRelation>()
    if (!resource) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    return NextResponse.json(resource)
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("GET /api/relations/[id]:", error)
    return NextResponse.json({ error: "リレーションの取得に失敗しました" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const container = await getContainer(CONTAINER)
    const { resource: existing } = await container.item(id, id).read<OntologyRelation>()
    if (!existing) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const updated: OntologyRelation = {
      ...existing,
      name: body.name ?? existing.name,
      description: body.description ?? existing.description,
      sourceClassId: body.sourceClassId ?? existing.sourceClassId,
      targetClassId: body.targetClassId ?? existing.targetClassId,
      parentRelationId: body.parentRelationId !== undefined ? body.parentRelationId : existing.parentRelationId,
      updatedAt: new Date().toISOString(),
    }
    const { resource } = await container.item(id, id).replace(updated)
    return NextResponse.json(resource)
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("PUT /api/relations/[id]:", error)
    return NextResponse.json({ error: "リレーションの更新に失敗しました" }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const container = await getContainer(CONTAINER)
    await container.item(id, id).delete()
    return new NextResponse(null, { status: 204 })
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("DELETE /api/relations/[id]:", error)
    return NextResponse.json({ error: "リレーションの削除に失敗しました" }, { status: 500 })
  }
}
