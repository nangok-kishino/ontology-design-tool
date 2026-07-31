import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { getPrincipalName } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/project-access"
import { isConfirmed } from "@/lib/instance-status"
import { relationAllowsPair } from "@/lib/triplet-resolve"
import type { Triplet, OntologyInstance, OntologyRelation } from "@/lib/types"

const CONTAINER = "triplets"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get("projectId")
    if (!projectId) return NextResponse.json({ error: "projectIdが必要です" }, { status: 400 })
    const access = await checkProjectAccess(request, projectId)
    if ("error" in access) return access.error

    const container = await getContainer(CONTAINER)
    const { resources } = await container.items
      .query<Triplet>({
        query: "SELECT * FROM c WHERE c.projectId = @projectId",
        parameters: [{ name: "@projectId", value: projectId }],
      })
      .fetchAll()
    return NextResponse.json(resources)
  } catch (error) {
    console.error("GET /api/triplets:", error)
    return NextResponse.json({ error: "トリプレット一覧の取得に失敗しました" }, { status: 500 })
  }
}

// 手動追加。主語・目的語は本登録インスタンス、述語は定義済みリレーション。
// (主語クラス, 目的語クラス) がリレーションの classPairs に無ければ 400（型矛盾）で作成不可。
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { projectId, subjectInstanceId, predicateRelationId, objectInstanceId } = body
    if (!projectId || !subjectInstanceId || !predicateRelationId || !objectInstanceId) {
      return NextResponse.json({ error: "projectId・主語・述語・目的語は必須です" }, { status: 400 })
    }
    const access = await checkProjectAccess(request, projectId)
    if ("error" in access) return access.error

    const [instContainer, relContainer, tripletContainer] = await Promise.all([
      getContainer("instances"),
      getContainer("relations"),
      getContainer(CONTAINER),
    ])

    const [{ resource: subject }, { resource: object }, { resource: relRaw }] = await Promise.all([
      instContainer.item(subjectInstanceId, subjectInstanceId).read<OntologyInstance>(),
      instContainer.item(objectInstanceId, objectInstanceId).read<OntologyInstance>(),
      relContainer.item(predicateRelationId, predicateRelationId).read<any>(),
    ])

    if (!subject || subject.projectId !== projectId) {
      return NextResponse.json({ error: "主語インスタンスが見つかりません" }, { status: 400 })
    }
    if (!object || object.projectId !== projectId) {
      return NextResponse.json({ error: "目的語インスタンスが見つかりません" }, { status: 400 })
    }
    if (!relRaw || relRaw.projectId !== projectId) {
      return NextResponse.json({ error: "述語リレーションが見つかりません" }, { status: 400 })
    }
    if (!isConfirmed(subject) || !isConfirmed(object)) {
      return NextResponse.json(
        { error: "主語・目的語はいずれも名寄せチェック済みインスタンスである必要があります" },
        { status: 400 },
      )
    }
    const relation: OntologyRelation = relRaw.classPairs
      ? relRaw
      : { ...relRaw, classPairs: [{ sourceClassId: relRaw.sourceClassId, targetClassId: relRaw.targetClassId }] }

    if (!relationAllowsPair(relation, subject.classId, object.classId)) {
      return NextResponse.json(
        {
          error: `型矛盾：〈${subject.name}〉→〈${object.name}〉の組み合わせは、リレーション「${relation.name}」の許可クラスペアに含まれていません。述語かリレーション定義を見直してください。`,
        },
        { status: 400 },
      )
    }

    // 同一トリプレット（主語・述語・目的語が同じ）の重複作成を防ぐ
    const { resources: dups } = await tripletContainer.items
      .query<Triplet>({
        query:
          "SELECT c.id FROM c WHERE c.projectId = @p AND c.subjectInstanceId = @s AND c.predicateRelationId = @r AND c.objectInstanceId = @o",
        parameters: [
          { name: "@p", value: projectId },
          { name: "@s", value: subjectInstanceId },
          { name: "@r", value: predicateRelationId },
          { name: "@o", value: objectInstanceId },
        ],
      })
      .fetchAll()
    if (dups.length > 0) {
      return NextResponse.json(
        { error: `同一のトリプレット（〈${subject.name}〉→「${relation.name}」→〈${object.name}〉）が既に登録されています。` },
        { status: 409 },
      )
    }

    const now = new Date().toISOString()
    const actor = getPrincipalName(request)
    const item: Triplet = {
      id: crypto.randomUUID(),
      projectId,
      subjectInstanceId,
      predicateRelationId,
      objectInstanceId,
      subjectName: subject.name,
      subjectClassId: subject.classId ?? null,
      predicateName: relation.name,
      objectName: object.name,
      objectClassId: object.classId ?? null,
      sourceDocName: body.sourceDocName ?? "手動追加",
      evidence: body.evidence ?? "",
      attributes: body.attributes ?? {},
      sourceCandidateId: body.sourceCandidateId,
      approvedBy: actor,
      approvedAt: now,
      createdBy: actor,
      updatedBy: actor,
      createdAt: now,
      updatedAt: now,
    }
    const { resource } = await tripletContainer.items.create(item)
    return NextResponse.json(resource, { status: 201 })
  } catch (error) {
    console.error("POST /api/triplets:", error)
    return NextResponse.json({ error: "トリプレットの作成に失敗しました" }, { status: 500 })
  }
}
