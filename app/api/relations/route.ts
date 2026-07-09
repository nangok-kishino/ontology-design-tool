import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { checkProjectAccess } from "@/lib/project-access"
import type { OntologyRelation } from "@/lib/types"

const CONTAINER = "relations"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get("projectId")
    const container = await getContainer(CONTAINER)

    const normalize = (r: any): OntologyRelation =>
      r.classPairs ? r : { ...r, classPairs: [{ sourceClassId: r.sourceClassId, targetClassId: r.targetClassId }] }

    if (projectId) {
      const access = await checkProjectAccess(request, projectId)
      if ("error" in access) return access.error
      const { resources } = await container.items
        .query<any>({
          query: "SELECT * FROM c WHERE c.projectId = @projectId",
          parameters: [{ name: "@projectId", value: projectId }],
        })
        .fetchAll()
      return NextResponse.json(resources.map(normalize))
    }

    const { resources } = await container.items.readAll<any>().fetchAll()
    return NextResponse.json(resources.map(normalize))
  } catch (error) {
    console.error("GET /api/relations:", error)
    return NextResponse.json({ error: "リレーション一覧の取得に失敗しました" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    if (body.projectId) {
      const access = await checkProjectAccess(request, body.projectId)
      if ("error" in access) return access.error
    }
    const now = new Date().toISOString()
    const item: OntologyRelation = {
      id: crypto.randomUUID(),
      projectId: body.projectId,
      name: body.name,
      nameEn: body.nameEn ?? "",
      description: body.description ?? "",
      classPairs: body.classPairs ?? [],
      parentRelationId: body.parentRelationId ?? null,
      createdAt: now,
      updatedAt: now,
    }
    const container = await getContainer(CONTAINER)
    const { resource } = await container.items.create(item)
    return NextResponse.json(resource, { status: 201 })
  } catch (error) {
    console.error("POST /api/relations:", error)
    return NextResponse.json({ error: "リレーションの作成に失敗しました" }, { status: 500 })
  }
}
