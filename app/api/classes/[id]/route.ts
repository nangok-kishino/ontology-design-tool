import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import type { OntologyClass } from "@/lib/types"

const CONTAINER = "classes"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const container = await getContainer(CONTAINER)
    const { resource } = await container.item(id, id).read<OntologyClass>()
    if (!resource) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    return NextResponse.json(resource)
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("GET /api/classes/[id]:", error)
    return NextResponse.json({ error: "クラスの取得に失敗しました" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const container = await getContainer(CONTAINER)
    const { resource: existing } = await container.item(id, id).read<OntologyClass>()
    if (!existing) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const updated: OntologyClass = {
      ...existing,
      name: body.name ?? existing.name,
      nameEn: body.nameEn !== undefined ? body.nameEn : (existing.nameEn ?? ""),
      description: body.description ?? existing.description,
      parentId: body.parentId !== undefined ? body.parentId : existing.parentId,
      updatedAt: new Date().toISOString(),
    }
    const { resource } = await container.item(id, id).replace(updated)
    return NextResponse.json(resource)
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("PUT /api/classes/[id]:", error)
    return NextResponse.json({ error: "クラスの更新に失敗しました" }, { status: 500 })
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
    console.error("DELETE /api/classes/[id]:", error)
    return NextResponse.json({ error: "クラスの削除に失敗しました" }, { status: 500 })
  }
}
