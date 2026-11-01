import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { getPrincipalName } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/project-access"
import { cleanSynonyms, findSynonymConflict, type LabelForSynonymCheck } from "@/lib/label-synonyms"
import { CATEGORY_LABEL_NAME, CONTAINERS, type Label } from "@/lib/graph-types"

const CONTAINER = CONTAINERS.labels

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get("projectId")
    const container = await getContainer(CONTAINER)

    if (projectId) {
      const access = await checkProjectAccess(request, projectId)
      if ("error" in access) return access.error
      const { resources } = await container.items
        .query<Label>({
          query: "SELECT * FROM c WHERE c.projectId = @projectId",
          parameters: [{ name: "@projectId", value: projectId }],
        })
        .fetchAll()
      return NextResponse.json(resources)
    }

    const { resources } = await container.items.readAll<Label>().fetchAll()
    return NextResponse.json(resources)
  } catch (error) {
    console.error("GET /api/labels:", error)
    return NextResponse.json({ error: "ラベル一覧の取得に失敗しました" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    if (!body.projectId) return NextResponse.json({ error: "projectId が必要です" }, { status: 400 })
    const access = await checkProjectAccess(request, body.projectId)
    if ("error" in access) return access.error

    const name: string = (body.name ?? "").trim()
    if (!name) return NextResponse.json({ error: "ラベル名を入力してください" }, { status: 400 })
    // 予約ラベルと同じ名前は作らせない（個体とカテゴリノードの区別に使うため）
    if (name === CATEGORY_LABEL_NAME) {
      return NextResponse.json({ error: `「${CATEGORY_LABEL_NAME}」は予約ラベルです` }, { status: 409 })
    }

    const container = await getContainer(CONTAINER)
    // 照合に使う列だけを読む（全列だと登録のたびにラベル全文を転送することになる）
    const { resources: siblings } = await container.items
      .query<LabelForSynonymCheck>({
        query: "SELECT c.id, c.name, c.synonyms FROM c WHERE c.projectId = @projectId",
        parameters: [{ name: "@projectId", value: body.projectId }],
      })
      .fetchAll()
    const synonyms = cleanSynonyms(body.synonyms, name)
    const conflict = findSynonymConflict(siblings, null, name, synonyms)
    if (conflict) return NextResponse.json({ error: conflict }, { status: 409 })

    const now = new Date().toISOString()
    const actor = getPrincipalName(request)
    const item: Label = {
      id: crypto.randomUUID(),
      projectId: body.projectId,
      name,
      nameEn: body.nameEn ?? "",
      synonyms,
      description: body.description ?? "",
      groupId: body.groupId ?? null,
      order: body.order,
      createdBy: actor,
      updatedBy: actor,
      createdAt: now,
      updatedAt: now,
    }
    const { resource } = await container.items.create(item)
    return NextResponse.json(resource, { status: 201 })
  } catch (error) {
    console.error("POST /api/labels:", error)
    return NextResponse.json({ error: "ラベルの作成に失敗しました" }, { status: 500 })
  }
}
