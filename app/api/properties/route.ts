import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { getPrincipalName } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/project-access"
import { bumpOwnerEditEvent } from "@/lib/graph-confirmation-server"
import { CONTAINERS, type PropertyDef, type PropertyTarget } from "@/lib/graph-types"

const CONTAINER = CONTAINERS.propertyDefs
const TARGETS: PropertyTarget[] = ["label", "relationshipType", "project"]

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const targetId = searchParams.get("targetId")
    const projectId = searchParams.get("projectId")
    const container = await getContainer(CONTAINER)

    if (targetId) {
      const { resources } = await container.items
        .query<PropertyDef>({
          query: "SELECT * FROM c WHERE c.targetId = @t",
          parameters: [{ name: "@t", value: targetId }],
        })
        .fetchAll()
      return NextResponse.json(resources)
    }
    if (projectId) {
      const { resources } = await container.items
        .query<PropertyDef>({
          query: "SELECT * FROM c WHERE c.projectId = @p",
          parameters: [{ name: "@p", value: projectId }],
        })
        .fetchAll()
      return NextResponse.json(resources)
    }
    return NextResponse.json({ error: "targetId または projectId が必要です" }, { status: 400 })
  } catch (error) {
    console.error("GET /api/properties:", error)
    return NextResponse.json({ error: "プロパティ定義の取得に失敗しました" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    if (!body.projectId) return NextResponse.json({ error: "projectId が必要です" }, { status: 400 })
    const access = await checkProjectAccess(request, body.projectId)
    if ("error" in access) return access.error

    const name: string = (body.name ?? "").trim()
    if (!name) return NextResponse.json({ error: "プロパティ名を入力してください" }, { status: 400 })
    const targetType: PropertyTarget = TARGETS.includes(body.targetType) ? body.targetType : "label"
    const targetId: string = targetType === "project" ? body.projectId : body.targetId
    if (!targetId) return NextResponse.json({ error: "targetId が必要です" }, { status: 400 })

    const container = await getContainer(CONTAINER)
    // 同じ持ち主に同名のプロパティを2つ作らせない（値は名前で引くため衝突する）
    const { resources: siblings } = await container.items
      .query<Pick<PropertyDef, "id" | "name">>({
        query: "SELECT c.id, c.name FROM c WHERE c.targetId = @t",
        parameters: [{ name: "@t", value: targetId }],
      })
      .fetchAll()
    if (siblings.some((p) => p.name === name)) {
      return NextResponse.json({ error: `「${name}」は既に定義されています` }, { status: 409 })
    }

    const now = new Date().toISOString()
    const item: PropertyDef = {
      id: crypto.randomUUID(),
      projectId: body.projectId,
      name,
      description: body.description ?? "",
      dataType: body.dataType ?? "文字列",
      required: body.required === "必須" ? "必須" : "任意",
      targetType,
      targetId,
      createdAt: now,
      updatedAt: now,
    }
    const { resource } = await container.items.create(item)
    await bumpOwnerEditEvent(targetType, targetId, getPrincipalName(request))
    return NextResponse.json(resource, { status: 201 })
  } catch (error) {
    console.error("POST /api/properties:", error)
    return NextResponse.json({ error: "プロパティの作成に失敗しました" }, { status: 500 })
  }
}
