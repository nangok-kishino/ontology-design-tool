import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { getPrincipalName } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/project-access"
import { appendEditEvent } from "@/lib/confirmation"
import { diffRelTypeFields } from "@/lib/graph-confirmation"
import { CONTAINERS, cleanLabelPairs, type PropertyDef, type Relationship, type RelationshipType } from "@/lib/graph-types"
import { syncRelTypeCopies } from "@/lib/relationship-copies"

const CONTAINER = CONTAINERS.relationshipTypes

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const container = await getContainer(CONTAINER)
    const { resource } = await container.item(id, id).read<RelationshipType>()
    if (!resource) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const access = await checkProjectAccess(request, resource.projectId)
    if ("error" in access) return access.error
    return NextResponse.json(resource)
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("GET /api/relationship-types/[id]:", error)
    return NextResponse.json({ error: "リレーションシップタイプの取得に失敗しました" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const container = await getContainer(CONTAINER)
    const { resource: existing } = await container.item(id, id).read<RelationshipType>()
    if (!existing) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const access = await checkProjectAccess(request, existing.projectId)
    if ("error" in access) return access.error

    const actor = getPrincipalName(request)
    const merged: RelationshipType = {
      ...existing,
      name: body.name ?? existing.name,
      nameEn: body.nameEn !== undefined ? body.nameEn : (existing.nameEn ?? ""),
      description: body.description ?? existing.description,
      labelPairs: body.labelPairs !== undefined ? cleanLabelPairs(body.labelPairs) : existing.labelPairs,
      conditions: body.conditions !== undefined ? body.conditions : existing.conditions,
      updatedBy: actor,
      updatedAt: new Date().toISOString(),
    }
    const updated: RelationshipType = {
      ...merged,
      confirmations: appendEditEvent(
        existing.confirmations,
        actor,
        diffRelTypeFields(existing, merged),
        merged.updatedAt,
      ),
    }
    const { resource } = await container.item(id, id).replace(updated)
    // 名前が変わったら、リレーションシップ側の写し（Cypher の型名にも使う）も合わせる
    if (resource && resource.name !== existing.name) await syncRelTypeCopies(resource)
    return NextResponse.json(resource)
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("PUT /api/relationship-types/[id]:", error)
    return NextResponse.json({ error: "リレーションシップタイプの更新に失敗しました" }, { status: 500 })
  }
}

// このタイプを使っているリレーションシップが残っていたら消させない。
// タイプを失ったリレーションシップは意味を持てないので、黙って残すより
// 「先にそちらを片付けてください」と言ったほうが事故が少ない。
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const container = await getContainer(CONTAINER)
    const { resource: existing } = await container.item(id, id).read<RelationshipType>()
    if (!existing) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const access = await checkProjectAccess(request, existing.projectId)
    if ("error" in access) return access.error

    const relContainer = await getContainer(CONTAINERS.relationships)
    const { resources: inUse } = await relContainer.items
      .query<Pick<Relationship, "id">>({
        query: "SELECT c.id FROM c WHERE c.projectId = @p AND c.relTypeId = @id",
        parameters: [{ name: "@p", value: existing.projectId }, { name: "@id", value: id }],
      })
      .fetchAll()
    if (inUse.length > 0) {
      return NextResponse.json(
        {
          error: `このタイプを使っているリレーションシップが${inUse.length}件あります。先にそちらを削除してください`,
          inUse: inUse.length,
        },
        { status: 409 },
      )
    }

    // このタイプのプロパティ定義も一緒に消す（残すと行き先のない定義になる）
    const propContainer = await getContainer(CONTAINERS.propertyDefs)
    const { resources: defs } = await propContainer.items
      .query<Pick<PropertyDef, "id">>({
        query: "SELECT c.id FROM c WHERE c.projectId = @p AND c.targetType = 'relationshipType' AND c.targetId = @id",
        parameters: [{ name: "@p", value: existing.projectId }, { name: "@id", value: id }],
      })
      .fetchAll()
    for (const d of defs) await propContainer.item(d.id, d.id).delete()

    await container.item(id, id).delete()
    return new NextResponse(null, { status: 204 })
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("DELETE /api/relationship-types/[id]:", error)
    return NextResponse.json({ error: "リレーションシップタイプの削除に失敗しました" }, { status: 500 })
  }
}
