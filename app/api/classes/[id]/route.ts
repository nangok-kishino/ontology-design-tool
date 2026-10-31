import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { getPrincipalName } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/project-access"
import { appendEditEvent, diffClassFields } from "@/lib/confirmation"
import { cleanSynonyms, findSynonymConflict, type ClassForSynonymCheck } from "@/lib/class-synonyms"
import type { OntologyClass } from "@/lib/types"

const CONTAINER = "classes"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const container = await getContainer(CONTAINER)
    const { resource } = await container.item(id, id).read<OntologyClass>()
    if (!resource) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const access = await checkProjectAccess(request, resource.projectId)
    if ("error" in access) return access.error
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
    const access = await checkProjectAccess(request, existing.projectId)
    if ("error" in access) return access.error
    const actor = getPrincipalName(request)
    const merged: OntologyClass = {
      ...existing,
      name: body.name ?? existing.name,
      nameEn: body.nameEn !== undefined ? body.nameEn : (existing.nameEn ?? ""),
      description: body.description ?? existing.description,
      parentId: body.parentId !== undefined ? body.parentId : existing.parentId,
      updatedBy: actor,
      updatedAt: new Date().toISOString(),
    }
    merged.synonyms = cleanSynonyms(body.synonyms !== undefined ? body.synonyms : (existing.synonyms ?? []), merged.name)
    // 同じ語が2つのクラスを指さないよう、同義語・クラス名をプロジェクト内の他クラスと照合する
    // 照合に使う列だけを読む（全列だと保存のたびにクラス全文を転送することになる）
    const { resources: siblings } = await container.items
      .query<ClassForSynonymCheck>({
        query: "SELECT c.id, c.name, c.synonyms FROM c WHERE c.projectId = @projectId",
        parameters: [{ name: "@projectId", value: existing.projectId }],
      })
      .fetchAll()
    const conflict = findSynonymConflict(siblings, id, merged.name, merged.synonyms)
    if (conflict) return NextResponse.json({ error: conflict }, { status: 409 })
    const changedFields = diffClassFields(existing, merged)
    const updated: OntologyClass = {
      ...merged,
      confirmations: appendEditEvent(existing.confirmations, actor, changedFields, merged.updatedAt),
    }
    const { resource } = await container.item(id, id).replace(updated)
    return NextResponse.json(resource)
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("PUT /api/classes/[id]:", error)
    return NextResponse.json({ error: "クラスの更新に失敗しました" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const container = await getContainer(CONTAINER)
    const { resource: existing } = await container.item(id, id).read<OntologyClass>()
    if (!existing) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const access = await checkProjectAccess(request, existing.projectId)
    if ("error" in access) return access.error
    await container.item(id, id).delete()
    return new NextResponse(null, { status: 204 })
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("DELETE /api/classes/[id]:", error)
    return NextResponse.json({ error: "クラスの削除に失敗しました" }, { status: 500 })
  }
}
