import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { getPrincipalName } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/project-access"
import { relationAllowsPair } from "@/lib/triplet-resolve"
import type { ClassTriplet, OntologyClass, OntologyInstance, OntologyRelation } from "@/lib/types"

// クラスのトリプレット（主語がクラス）。インスタンスのトリプレットとは別物なので
// コンテナも分けてある。既存の /api/triplets には一切影響しない。
const CONTAINER = "classTriplets"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get("projectId")
    if (!projectId) return NextResponse.json({ error: "projectIdが必要です" }, { status: 400 })
    const access = await checkProjectAccess(request, projectId)
    if ("error" in access) return access.error

    const container = await getContainer(CONTAINER)
    const { resources } = await container.items
      .query<ClassTriplet>({
        query: "SELECT * FROM c WHERE c.projectId = @projectId",
        parameters: [{ name: "@projectId", value: projectId }],
      })
      .fetchAll()
    return NextResponse.json(resources)
  } catch (error) {
    console.error("GET /api/class-triplets:", error)
    return NextResponse.json({ error: "クラストリプレット一覧の取得に失敗しました" }, { status: 500 })
  }
}

// 主語クラス・述語リレーション・目的語（クラスまたはインスタンス）から1件作る。
// 目的語がインスタンスのときは、そのインスタンスのクラスで型を照合する。
// 子クラスは親クラスの宣言を継承するので、照合は継承込みで見る。
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { projectId, subjectClassId, predicateRelationId, objectKind, objectId } = body
    if (!projectId || !subjectClassId || !predicateRelationId || !objectId) {
      return NextResponse.json({ error: "projectId・主語クラス・述語・目的語は必須です" }, { status: 400 })
    }
    if (objectKind !== "class" && objectKind !== "instance") {
      return NextResponse.json({ error: "目的語の種類が不正です" }, { status: 400 })
    }
    const access = await checkProjectAccess(request, projectId)
    if ("error" in access) return access.error

    const [classContainer, relContainer, instContainer, container] = await Promise.all([
      getContainer("classes"),
      getContainer("relations"),
      getContainer("instances"),
      getContainer(CONTAINER),
    ])

    const { resources: classes } = await classContainer.items
      .query<OntologyClass>({
        query: "SELECT * FROM c WHERE c.projectId = @p",
        parameters: [{ name: "@p", value: projectId }],
      })
      .fetchAll()
    const subject = classes.find((c) => c.id === subjectClassId)
    if (!subject) return NextResponse.json({ error: "主語クラスが見つかりません" }, { status: 400 })

    const { resource: relRaw } = await relContainer.item(predicateRelationId, predicateRelationId).read<any>()
    if (!relRaw || relRaw.projectId !== projectId) {
      return NextResponse.json({ error: "述語リレーションが見つかりません" }, { status: 400 })
    }
    const relation: OntologyRelation = relRaw.classPairs
      ? relRaw
      : { ...relRaw, classPairs: [{ sourceClassId: relRaw.sourceClassId, targetClassId: relRaw.targetClassId }] }

    let objectName: string
    let objectClassId: string
    if (objectKind === "class") {
      const target = classes.find((c) => c.id === objectId)
      if (!target) return NextResponse.json({ error: "目的語クラスが見つかりません" }, { status: 400 })
      objectName = target.name
      objectClassId = target.id
    } else {
      const { resource: inst } = await instContainer.item(objectId, objectId).read<OntologyInstance>()
      if (!inst || inst.projectId !== projectId) {
        return NextResponse.json({ error: "目的語インスタンスが見つかりません" }, { status: 400 })
      }
      if (!inst.classId) {
        return NextResponse.json({ error: "目的語インスタンスにクラスが設定されていません" }, { status: 400 })
      }
      objectName = inst.name
      objectClassId = inst.classId
    }

    if (!relationAllowsPair(relation, subjectClassId, objectClassId, classes)) {
      return NextResponse.json(
        {
          error: `型矛盾：〈${subject.name}〉→〈${objectName}〉の組み合わせは、リレーション「${relation.name}」の許可クラスペアに含まれていません。`,
        },
        { status: 400 },
      )
    }

    const { resources: dups } = await container.items
      .query<ClassTriplet>({
        query:
          "SELECT c.id FROM c WHERE c.projectId = @p AND c.subjectClassId = @s AND c.predicateRelationId = @r AND c.objectId = @o",
        parameters: [
          { name: "@p", value: projectId },
          { name: "@s", value: subjectClassId },
          { name: "@r", value: predicateRelationId },
          { name: "@o", value: objectId },
        ],
      })
      .fetchAll()
    if (dups.length > 0) {
      return NextResponse.json(
        { error: `同一のクラストリプレット（〈${subject.name}〉→「${relation.name}」→〈${objectName}〉）が既に登録されています。` },
        { status: 409 },
      )
    }

    const now = new Date().toISOString()
    const actor = getPrincipalName(request)
    const item: ClassTriplet = {
      id: crypto.randomUUID(),
      projectId,
      subjectClassId,
      predicateRelationId,
      objectKind,
      objectId,
      subjectName: subject.name,
      predicateName: relation.name,
      objectName,
      createdBy: actor,
      updatedBy: actor,
      createdAt: now,
      updatedAt: now,
    }
    const { resource } = await container.items.create(item)
    return NextResponse.json(resource, { status: 201 })
  } catch (error) {
    console.error("POST /api/class-triplets:", error)
    return NextResponse.json({ error: "クラストリプレットの作成に失敗しました" }, { status: 500 })
  }
}
