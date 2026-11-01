import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { getPrincipalName } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/project-access"
import { appendEditEvent } from "@/lib/confirmation"
import { CONTAINERS, type Relationship } from "@/lib/graph-types"

const CONTAINER = CONTAINERS.relationships

// 編集で確認履歴の [edit] を積むべきフィールド。order は整理の都合なので含めない。
function diffFields(before: Relationship, after: Relationship): string[] {
  const changed: string[] = []
  if (JSON.stringify(before.properties ?? {}) !== JSON.stringify(after.properties ?? {})) {
    changed.push("properties")
  }
  if (JSON.stringify(before.conditions ?? {}) !== JSON.stringify(after.conditions ?? {})) {
    changed.push("conditions")
  }
  if ((before.evidence ?? "") !== (after.evidence ?? "")) changed.push("evidence")
  return changed
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const container = await getContainer(CONTAINER)
    const { resource } = await container.item(id, id).read<Relationship>()
    if (!resource) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const access = await checkProjectAccess(request, resource.projectId)
    if ("error" in access) return access.error
    return NextResponse.json(resource)
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("GET /api/relationships/[id]:", error)
    return NextResponse.json({ error: "リレーションシップの取得に失敗しました" }, { status: 500 })
  }
}

// 端（始点・終点・タイプ）は付け替えさせない。組み合わせを変えるのは別物を作るのと同じなので、
// 作り直してもらう（スナップショットとの食い違いを持ち込まないため）。
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const container = await getContainer(CONTAINER)
    const { resource: existing } = await container.item(id, id).read<Relationship>()
    if (!existing) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const access = await checkProjectAccess(request, existing.projectId)
    if ("error" in access) return access.error

    const actor = getPrincipalName(request)
    const merged: Relationship = {
      ...existing,
      properties: body.properties !== undefined ? body.properties : existing.properties,
      conditions: body.conditions !== undefined ? body.conditions : existing.conditions,
      evidence: body.evidence !== undefined ? body.evidence : existing.evidence,
      updatedBy: actor,
      updatedAt: new Date().toISOString(),
    }
    const updated: Relationship = {
      ...merged,
      confirmations: appendEditEvent(
        existing.confirmations,
        actor,
        diffFields(existing, merged),
        merged.updatedAt,
      ),
    }
    const { resource } = await container.item(id, id).replace(updated)
    return NextResponse.json(resource)
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("PUT /api/relationships/[id]:", error)
    return NextResponse.json({ error: "リレーションシップの更新に失敗しました" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const container = await getContainer(CONTAINER)
    const { resource: existing } = await container.item(id, id).read<Relationship>()
    if (!existing) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const access = await checkProjectAccess(request, existing.projectId)
    if ("error" in access) return access.error
    await container.item(id, id).delete()
    return new NextResponse(null, { status: 204 })
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("DELETE /api/relationships/[id]:", error)
    return NextResponse.json({ error: "リレーションシップの削除に失敗しました" }, { status: 500 })
  }
}
