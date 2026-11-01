import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { getPrincipalName } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/project-access"
import { appendEditEvent } from "@/lib/confirmation"
import { normalizeName, trimName } from "@/lib/normalize"
import { CONTAINERS, type GraphNode, type Relationship } from "@/lib/graph-types"
import { syncNodeCopies } from "@/lib/relationship-copies"

const CONTAINER = CONTAINERS.nodes

// ノード編集で確認履歴の [edit] を積むべきフィールド。order は整理の都合なので含めない。
function diffNodeFields(before: GraphNode, after: GraphNode): string[] {
  const changed: string[] = []
  if ((before.name ?? "") !== (after.name ?? "")) changed.push("name")
  const a = [...(before.labelIds ?? [])].sort().join("|")
  const b = [...(after.labelIds ?? [])].sort().join("|")
  if (a !== b) changed.push("labelIds")
  if (JSON.stringify(before.properties ?? {}) !== JSON.stringify(after.properties ?? {})) {
    changed.push("properties")
  }
  return changed
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const container = await getContainer(CONTAINER)
    const { resource } = await container.item(id, id).read<GraphNode>()
    if (!resource) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const access = await checkProjectAccess(request, resource.projectId)
    if ("error" in access) return access.error
    return NextResponse.json(resource)
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("GET /api/nodes/[id]:", error)
    return NextResponse.json({ error: "ノードの取得に失敗しました" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const container = await getContainer(CONTAINER)
    const { resource: existing } = await container.item(id, id).read<GraphNode>()
    if (!existing) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const access = await checkProjectAccess(request, existing.projectId)
    if ("error" in access) return access.error

    const actor = getPrincipalName(request)
    const name = body.name !== undefined ? trimName(body.name) : existing.name
    if (!name) return NextResponse.json({ error: "ノード名を入力してください" }, { status: 400 })
    const labelIds: string[] = Array.isArray(body.labelIds)
      ? [...new Set(body.labelIds.filter((v: unknown) => typeof v === "string"))] as string[]
      : (existing.labelIds ?? [])
    const normalized = normalizeName(name)

    const merged: GraphNode = {
      ...existing,
      name,
      labelIds,
      properties: body.properties !== undefined ? body.properties : existing.properties,
      normalizedName: normalized,
      status: body.status ?? existing.status,
      aliases: body.aliases !== undefined ? body.aliases : existing.aliases,
      mergedInto: body.mergedInto !== undefined ? body.mergedInto : existing.mergedInto,
      updatedBy: actor,
      updatedAt: new Date().toISOString(),
    }
    // 名寄せチェック済みのノードの名前が実質変わったら、未チェックへ差し戻す
    if (
      existing.status === "confirmed" &&
      body.status === undefined &&
      normalizeName(existing.name) !== normalized
    ) {
      merged.status = "provisional"
    }

    const updated: GraphNode = {
      ...merged,
      confirmations: appendEditEvent(
        existing.confirmations,
        actor,
        diffNodeFields(existing, merged),
        merged.updatedAt,
      ),
    }
    const { resource } = await container.item(id, id).replace(updated)
    // 名前・ラベルが変わったら、リレーションシップ側の写しも合わせる
    const changed = diffNodeFields(existing, merged)
    if (resource && (changed.includes("name") || changed.includes("labelIds"))) {
      await syncNodeCopies(resource)
    }
    return NextResponse.json(resource)
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("PUT /api/nodes/[id]:", error)
    return NextResponse.json({ error: "ノードの更新に失敗しました" }, { status: 500 })
  }
}

// このノードが端になっているリレーションシップが残っていたら消させない。
// 端を失ったリレーションシップは意味を持てないため（リレーションシップタイプと同じ扱い）。
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const container = await getContainer(CONTAINER)
    const { resource: existing } = await container.item(id, id).read<GraphNode>()
    if (!existing) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const access = await checkProjectAccess(request, existing.projectId)
    if ("error" in access) return access.error

    const relContainer = await getContainer(CONTAINERS.relationships)
    const { resources: inUse } = await relContainer.items
      .query<Pick<Relationship, "id">>({
        query:
          "SELECT c.id FROM c WHERE c.projectId = @p AND (c.startNodeId = @id OR c.endNodeId = @id)",
        parameters: [{ name: "@p", value: existing.projectId }, { name: "@id", value: id }],
      })
      .fetchAll()
    if (inUse.length > 0) {
      return NextResponse.json(
        {
          error: `このノードが端になっているリレーションシップが${inUse.length}件あります。先にそちらを削除してください`,
          inUse: inUse.length,
        },
        { status: 409 },
      )
    }

    await container.item(id, id).delete()
    return new NextResponse(null, { status: 204 })
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("DELETE /api/nodes/[id]:", error)
    return NextResponse.json({ error: "ノードの削除に失敗しました" }, { status: 500 })
  }
}
