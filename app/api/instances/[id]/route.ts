import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { getPrincipalName } from "@/lib/auth"
import type { OntologyInstance } from "@/lib/types"

const CONTAINER = "instances"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const container = await getContainer(CONTAINER)
    const { resource } = await container.item(id, id).read<OntologyInstance>()
    if (!resource) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    return NextResponse.json(resource)
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("GET /api/instances/[id]:", error)
    return NextResponse.json({ error: "インスタンスの取得に失敗しました" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const container = await getContainer(CONTAINER)
    const { resource: existing } = await container.item(id, id).read<OntologyInstance>()
    if (!existing) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const now = new Date().toISOString().split("T")[0]
    const updated: OntologyInstance = {
      ...existing,
      name: body.name ?? existing.name,
      classId: "classId" in body ? (body.classId ?? null) : existing.classId,
      attributes: body.attributes !== undefined ? body.attributes : existing.attributes,
      updatedBy: getPrincipalName(request),
      updatedAt: now,
    }
    const { resource } = await container.item(id, id).replace(updated)
    return NextResponse.json(resource)
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("PUT /api/instances/[id]:", error)
    return NextResponse.json({ error: "インスタンスの更新に失敗しました" }, { status: 500 })
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
    console.error("DELETE /api/instances/[id]:", error)
    return NextResponse.json({ error: "インスタンスの削除に失敗しました" }, { status: 500 })
  }
}
