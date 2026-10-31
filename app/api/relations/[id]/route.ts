import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { getPrincipalName } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/project-access"
import { appendEditEvent, diffRelationFields } from "@/lib/confirmation"
import { loadClassParents } from "@/lib/class-parents"
import { normalizeClassPairs } from "@/lib/relation-inherit"
import type { OntologyRelation } from "@/lib/types"

const CONTAINER = "relations"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const container = await getContainer(CONTAINER)
    const { resource: raw } = await container.item(id, id).read<any>()
    if (!raw) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const access = await checkProjectAccess(request, raw.projectId)
    if ("error" in access) return access.error
    const resource: OntologyRelation = raw.classPairs ? raw : { ...raw, classPairs: [{ sourceClassId: raw.sourceClassId, targetClassId: raw.targetClassId }] }
    return NextResponse.json({
      ...resource,
      classPairs: normalizeClassPairs(resource.classPairs, await loadClassParents(raw.projectId)),
    })
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
    const { resource: rawExisting } = await container.item(id, id).read<any>()
    if (!rawExisting) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const access = await checkProjectAccess(request, rawExisting.projectId)
    if ("error" in access) return access.error
    const existing: OntologyRelation = rawExisting.classPairs ? rawExisting : { ...rawExisting, classPairs: [{ sourceClassId: rawExisting.sourceClassId, targetClassId: rawExisting.targetClassId }] }
    const actor = getPrincipalName(request)
    // 子クラスは親の宣言を継承するので、保存するペアは親だけに畳む
    const classes = await loadClassParents(existing.projectId)
    const merged: OntologyRelation = {
      ...existing,
      name: body.name ?? existing.name,
      nameEn: body.nameEn !== undefined ? body.nameEn : (existing.nameEn ?? ""),
      description: body.description ?? existing.description,
      classPairs: normalizeClassPairs(body.classPairs ?? existing.classPairs, classes),
      parentRelationId: body.parentRelationId !== undefined ? body.parentRelationId : existing.parentRelationId,
      conditions: Array.isArray(body.conditions) ? body.conditions : (existing.conditions ?? []),
      updatedBy: actor,
      updatedAt: new Date().toISOString(),
    }
    // 畳んだこと自体は意味の変更ではないので、確認済みを無効化しない（比較する前も畳んでおく）
    const changedFields = diffRelationFields(
      { ...existing, classPairs: normalizeClassPairs(existing.classPairs, classes) },
      merged,
    )
    const updated: OntologyRelation = {
      ...merged,
      confirmations: appendEditEvent(existing.confirmations, actor, changedFields, merged.updatedAt),
    }
    const { resource } = await container.item(id, id).replace(updated)
    return NextResponse.json(resource)
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("PUT /api/relations/[id]:", error)
    return NextResponse.json({ error: "リレーションの更新に失敗しました" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const container = await getContainer(CONTAINER)
    const { resource: existing } = await container.item(id, id).read<any>()
    if (!existing) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const access = await checkProjectAccess(request, existing.projectId)
    if ("error" in access) return access.error
    await container.item(id, id).delete()
    return new NextResponse(null, { status: 204 })
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("DELETE /api/relations/[id]:", error)
    return NextResponse.json({ error: "リレーションの削除に失敗しました" }, { status: 500 })
  }
}
