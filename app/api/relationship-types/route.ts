import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { getPrincipalName } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/project-access"
import { CONTAINERS, cleanLabelPairs, type RelationshipType } from "@/lib/graph-types"

const CONTAINER = CONTAINERS.relationshipTypes

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get("projectId")
    const container = await getContainer(CONTAINER)

    if (projectId) {
      const access = await checkProjectAccess(request, projectId)
      if ("error" in access) return access.error
      const { resources } = await container.items
        .query<RelationshipType>({
          query: "SELECT * FROM c WHERE c.projectId = @projectId",
          parameters: [{ name: "@projectId", value: projectId }],
        })
        .fetchAll()
      return NextResponse.json(resources)
    }

    const { resources } = await container.items.readAll<RelationshipType>().fetchAll()
    return NextResponse.json(resources)
  } catch (error) {
    console.error("GET /api/relationship-types:", error)
    return NextResponse.json({ error: "リレーションシップタイプ一覧の取得に失敗しました" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    if (!body.projectId) return NextResponse.json({ error: "projectId が必要です" }, { status: 400 })
    const access = await checkProjectAccess(request, body.projectId)
    if ("error" in access) return access.error

    const name: string = (body.name ?? "").trim()
    if (!name) return NextResponse.json({ error: "リレーションシップタイプ名を入力してください" }, { status: 400 })

    const now = new Date().toISOString()
    const actor = getPrincipalName(request)
    const item: RelationshipType = {
      id: crypto.randomUUID(),
      projectId: body.projectId,
      name,
      nameEn: body.nameEn ?? "",
      description: body.description ?? "",
      labelPairs: cleanLabelPairs(body.labelPairs),
      conditions: Array.isArray(body.conditions) ? body.conditions : [],
      groupId: body.groupId ?? null,
      order: body.order,
      createdBy: actor,
      updatedBy: actor,
      createdAt: now,
      updatedAt: now,
    }
    const container = await getContainer(CONTAINER)
    const { resource } = await container.items.create(item)
    return NextResponse.json(resource, { status: 201 })
  } catch (error) {
    console.error("POST /api/relationship-types:", error)
    return NextResponse.json({ error: "リレーションシップタイプの作成に失敗しました" }, { status: 500 })
  }
}
