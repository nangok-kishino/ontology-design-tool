import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { getPrincipalName } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/project-access"
import { cleanSynonyms, findSynonymConflict, type ClassForSynonymCheck } from "@/lib/class-synonyms"
import type { OntologyClass } from "@/lib/types"

const CONTAINER = "classes"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get("projectId")
    const container = await getContainer(CONTAINER)

    if (projectId) {
      const access = await checkProjectAccess(request, projectId)
      if ("error" in access) return access.error
      const { resources } = await container.items
        .query<OntologyClass>({
          query: "SELECT * FROM c WHERE c.projectId = @projectId",
          parameters: [{ name: "@projectId", value: projectId }],
        })
        .fetchAll()
      return NextResponse.json(resources)
    }

    const { resources } = await container.items.readAll<OntologyClass>().fetchAll()
    return NextResponse.json(resources)
  } catch (error) {
    console.error("GET /api/classes:", error)
    return NextResponse.json({ error: "クラス一覧の取得に失敗しました" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    if (body.projectId) {
      const access = await checkProjectAccess(request, body.projectId)
      if ("error" in access) return access.error
    }
    const container = await getContainer(CONTAINER)
    // 同じ語が2つのクラスを指さないよう、同義語・クラス名をプロジェクト内の他クラスと照合する
    const synonyms = cleanSynonyms(body.synonyms, body.name ?? "")
    // 照合に使う列だけを読む（全列だと登録のたびにクラス全文を転送することになる）
    const { resources: siblings } = await container.items
      .query<ClassForSynonymCheck>({
        query: "SELECT c.id, c.name, c.synonyms FROM c WHERE c.projectId = @projectId",
        parameters: [{ name: "@projectId", value: body.projectId }],
      })
      .fetchAll()
    const conflict = findSynonymConflict(siblings, null, body.name ?? "", synonyms)
    if (conflict) return NextResponse.json({ error: conflict }, { status: 409 })
    const now = new Date().toISOString()
    const actor = getPrincipalName(request)
    const item: OntologyClass = {
      id: crypto.randomUUID(),
      projectId: body.projectId,
      name: body.name,
      nameEn: body.nameEn ?? "",
      synonyms,
      description: body.description ?? "",
      parentId: body.parentId ?? null,
      createdBy: actor,
      updatedBy: actor,
      createdAt: now,
      updatedAt: now,
    }
    const { resource } = await container.items.create(item)
    return NextResponse.json(resource, { status: 201 })
  } catch (error) {
    console.error("POST /api/classes:", error)
    return NextResponse.json({ error: "クラスの作成に失敗しました" }, { status: 500 })
  }
}
