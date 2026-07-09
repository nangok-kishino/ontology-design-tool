import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { getPrincipalName } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/project-access"
import type { OntologyInstance } from "@/lib/types"

const CONTAINER = "instances"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const classId = searchParams.get("classId")
    const projectId = searchParams.get("projectId")
    const container = await getContainer(CONTAINER)

    if (projectId) {
      const access = await checkProjectAccess(request, projectId)
      if ("error" in access) return access.error
    }

    if (classId === "unclassified") {
      const { resources } = await container.items
        .query<OntologyInstance>({
          query: "SELECT * FROM c WHERE IS_NULL(c.classId) OR NOT IS_DEFINED(c.classId)",
        })
        .fetchAll()
      return NextResponse.json(resources)
    }

    if (classId) {
      const { resources } = await container.items
        .query<OntologyInstance>({
          query: "SELECT * FROM c WHERE c.classId = @classId",
          parameters: [{ name: "@classId", value: classId }],
        })
        .fetchAll()
      return NextResponse.json(resources)
    }

    if (projectId) {
      const { resources } = await container.items
        .query<OntologyInstance>({
          query: "SELECT * FROM c WHERE c.projectId = @projectId",
          parameters: [{ name: "@projectId", value: projectId }],
        })
        .fetchAll()
      return NextResponse.json(resources)
    }

    const { resources } = await container.items.readAll<OntologyInstance>().fetchAll()
    return NextResponse.json(resources)
  } catch (error) {
    console.error("GET /api/instances:", error)
    return NextResponse.json({ error: "インスタンス一覧の取得に失敗しました" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    if (body.projectId) {
      const access = await checkProjectAccess(request, body.projectId)
      if ("error" in access) return access.error
    }
    const now = new Date().toISOString().split("T")[0]
    const actor = getPrincipalName(request)
    const item: OntologyInstance = {
      id: crypto.randomUUID(),
      projectId: body.projectId,
      name: body.name,
      classId: body.classId ?? null,
      registeredBy: actor,
      registeredAt: now,
      updatedBy: actor,
      updatedAt: now,
      attributes: body.attributes ?? {},
    }
    const container = await getContainer(CONTAINER)
    const { resource } = await container.items.create(item)
    return NextResponse.json(resource, { status: 201 })
  } catch (error) {
    console.error("POST /api/instances:", error)
    return NextResponse.json({ error: "インスタンスの作成に失敗しました" }, { status: 500 })
  }
}
