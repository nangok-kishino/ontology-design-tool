import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { getPrincipalName } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/project-access"
import { bumpOwnerEditEvent } from "@/lib/graph-confirmation-server"
import { CONTAINERS, type GraphNode, type PropertyDef, type Relationship } from "@/lib/graph-types"

const CONTAINER = CONTAINERS.propertyDefs

// このプロパティの値が乗りうる入れ物。ノードとリレーションシップのどちらを見るかは持ち主で決まる。
function valueContainersFor(targetType: PropertyDef["targetType"]): string[] {
  if (targetType === "label") return [CONTAINERS.nodes]
  if (targetType === "relationshipType") return [CONTAINERS.relationships]
  return [CONTAINERS.nodes, CONTAINERS.relationships]
}

type Valued = (GraphNode | Relationship) & { properties?: Record<string, string> }

async function rowsWithKey(containerId: string, projectId: string, key: string): Promise<Valued[]> {
  const container = await getContainer(containerId)
  const { resources } = await container.items
    .query<Valued>({
      query: "SELECT * FROM c WHERE c.projectId = @p AND IS_DEFINED(c.properties)",
      parameters: [{ name: "@p", value: projectId }],
    })
    .fetchAll()
  return resources.filter((r) => r.properties && key in r.properties)
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const container = await getContainer(CONTAINER)
    const { resource: existing } = await container.item(id, id).read<PropertyDef>()
    if (!existing) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const access = await checkProjectAccess(request, existing.projectId)
    if ("error" in access) return access.error

    const nextName: string = (body.name ?? existing.name).trim()
    if (!nextName) return NextResponse.json({ error: "プロパティ名を入力してください" }, { status: 400 })

    // 同じ持ち主に同名が2つできないようにする
    if (nextName !== existing.name) {
      const { resources: siblings } = await container.items
        .query<Pick<PropertyDef, "id" | "name">>({
          query: "SELECT c.id, c.name FROM c WHERE c.targetId = @t",
          parameters: [{ name: "@t", value: existing.targetId }],
        })
        .fetchAll()
      if (siblings.some((p) => p.id !== id && p.name === nextName)) {
        return NextResponse.json({ error: `「${nextName}」は既に定義されています` }, { status: 409 })
      }
    }

    const updated: PropertyDef = {
      ...existing,
      name: nextName,
      description: body.description !== undefined ? body.description : (existing.description ?? ""),
      dataType: body.dataType ?? existing.dataType,
      required: body.required ?? existing.required,
      updatedAt: new Date().toISOString(),
    }
    const { resource } = await container.item(id, id).replace(updated)

    // 名前が変わったら、既に入っている値のキーも付け替える。
    // ただし、同じ名前を使う別の定義がまだ残っているなら付け替えない
    // （値はプロジェクト内で名前を共有しているため、片方だけ変えると取り違える）。
    let rekeyed = 0
    let sharedWithOthers = false
    if (nextName !== existing.name) {
      const { resources: sameName } = await container.items
        .query<Pick<PropertyDef, "id">>({
          query: "SELECT c.id FROM c WHERE c.projectId = @p AND c.name = @n",
          parameters: [{ name: "@p", value: existing.projectId }, { name: "@n", value: existing.name }],
        })
        .fetchAll()
      sharedWithOthers = sameName.some((p) => p.id !== id)
      if (!sharedWithOthers) {
        for (const containerId of valueContainersFor(existing.targetType)) {
          const target = await getContainer(containerId)
          for (const row of await rowsWithKey(containerId, existing.projectId, existing.name)) {
            const props = { ...row.properties }
            props[nextName] = props[existing.name]
            delete props[existing.name]
            await target.item(row.id, row.id).replace({ ...row, properties: props })
            rekeyed++
          }
        }
      }
    }

    await bumpOwnerEditEvent(existing.targetType, existing.targetId, getPrincipalName(request))
    return NextResponse.json({ ...resource, rekeyed, sharedWithOthers })
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("PUT /api/properties/[id]:", error)
    return NextResponse.json({ error: "プロパティの更新に失敗しました" }, { status: 500 })
  }
}

// ?values=remove を付けると、入っている値も一緒に消す。既定は定義だけ消して値は残す。
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const removeValues = searchParams.get("values") === "remove"

    const container = await getContainer(CONTAINER)
    const { resource: existing } = await container.item(id, id).read<PropertyDef>()
    if (!existing) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const access = await checkProjectAccess(request, existing.projectId)
    if ("error" in access) return access.error

    let removed = 0
    if (removeValues) {
      // 同じ名前の定義が他に残っているなら値は消さない（別の定義がまだ使っている）
      const { resources: sameName } = await container.items
        .query<Pick<PropertyDef, "id">>({
          query: "SELECT c.id FROM c WHERE c.projectId = @p AND c.name = @n",
          parameters: [{ name: "@p", value: existing.projectId }, { name: "@n", value: existing.name }],
        })
        .fetchAll()
      if (!sameName.some((p) => p.id !== id)) {
        for (const containerId of valueContainersFor(existing.targetType)) {
          const target = await getContainer(containerId)
          for (const row of await rowsWithKey(containerId, existing.projectId, existing.name)) {
            const props = { ...row.properties }
            delete props[existing.name]
            await target.item(row.id, row.id).replace({ ...row, properties: props })
            removed++
          }
        }
      }
    }

    await container.item(id, id).delete()
    await bumpOwnerEditEvent(existing.targetType, existing.targetId, getPrincipalName(request))
    return NextResponse.json({ removed })
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("DELETE /api/properties/[id]:", error)
    return NextResponse.json({ error: "プロパティの削除に失敗しました" }, { status: 500 })
  }
}
