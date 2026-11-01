import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { getPrincipalName } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/project-access"
import { loadClassParents } from "@/lib/class-parents"
import { normalizeClassPairs } from "@/lib/relation-inherit"
import { groupsOf } from "@/lib/organize"
import { migrateLegacyConditions, normalizeConditionSlots } from "@/lib/relation-conditions"
import type { OntologyRelation } from "@/lib/types"

const CONTAINER = "relations"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get("projectId")
    const container = await getContainer(CONTAINER)

    // 具体値をリレーションに持たせていた頃の条件は、条件項目へ読み替えて返す
    // （保存はし直さない。移すかどうかは人が決める）。
    const normalize = (r: any): OntologyRelation => ({
      ...r,
      classPairs: r.classPairs ?? [{ sourceClassId: r.sourceClassId, targetClassId: r.targetClassId }],
      conditions: migrateLegacyConditions(r.conditions),
    })

    if (projectId) {
      const access = await checkProjectAccess(request, projectId)
      if ("error" in access) return access.error
      const [{ resources }, classes] = await Promise.all([
        container.items
          .query<any>({
            query: "SELECT * FROM c WHERE c.projectId = @projectId",
            parameters: [{ name: "@projectId", value: projectId }],
          })
          .fetchAll(),
        loadClassParents(projectId),
      ])
      // 子クラスは親の宣言を継承するので、親で説明できるペア・参照先が消えたペアは返さない。
      // （過去に子クラス分まで展開して保存されたデータが、「不明」として残り続けないように）
      return NextResponse.json(
        resources.map(normalize).map((r) => ({ ...r, classPairs: normalizeClassPairs(r.classPairs, classes) })),
      )
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
    // 登録時に選んだ整理用グループ。このプロジェクトのリレーション用グループに
    // 無いものを渡されたら未分類として扱う。
    let groupId: string | null = null
    if (body.projectId) {
      const access = await checkProjectAccess(request, body.projectId)
      if ("error" in access) return access.error
      const known = new Set(groupsOf(access.project, "relation").map((g) => g.id))
      groupId = body.groupId && known.has(body.groupId) ? body.groupId : null
    }
    const classes = body.projectId ? await loadClassParents(body.projectId) : []
    const now = new Date().toISOString()
    const actor = getPrincipalName(request)
    const item: OntologyRelation = {
      id: crypto.randomUUID(),
      projectId: body.projectId,
      name: body.name,
      nameEn: body.nameEn ?? "",
      description: body.description ?? "",
      // 子クラス分のペアは持たない（親の宣言を継承する）
      classPairs: normalizeClassPairs(body.classPairs ?? [], classes),
      parentRelationId: body.parentRelationId ?? null,
      // 条件は項目（対象データ名・単位）だけ。具体値はトリプレット側に持つ。
      conditions: normalizeConditionSlots(body.conditions),
      groupId,
      order: typeof body.order === "number" ? body.order : undefined,
      createdBy: actor,
      updatedBy: actor,
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
