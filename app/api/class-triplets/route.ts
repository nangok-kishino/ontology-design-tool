import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { getPrincipalName } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/project-access"
import { relationAllowsPair } from "@/lib/triplet-resolve"
import { normalizeTripletConditions } from "@/lib/relation-conditions"
import type { ClassTriplet, OntologyClass, OntologyInstance, OntologyRelation } from "@/lib/types"

// どちらかの端がクラスであるトリプレット。インスタンス同士（/api/triplets）とは
// 別のコンテナで扱う。
const CONTAINER = "classTriplets"

// 主語がクラス固定だった頃のデータを今の形に読み替える
function normalize(raw: any): ClassTriplet {
  if (raw?.subjectKind) return raw as ClassTriplet
  return { ...raw, subjectKind: "class", subjectId: raw.subjectClassId }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get("projectId")
    if (!projectId) return NextResponse.json({ error: "projectIdが必要です" }, { status: 400 })
    const access = await checkProjectAccess(request, projectId)
    if ("error" in access) return access.error

    const container = await getContainer(CONTAINER)
    const { resources } = await container.items
      .query<any>({
        query: "SELECT * FROM c WHERE c.projectId = @projectId",
        parameters: [{ name: "@projectId", value: projectId }],
      })
      .fetchAll()
    return NextResponse.json(resources.map(normalize))
  } catch (error) {
    console.error("GET /api/class-triplets:", error)
    return NextResponse.json({ error: "クラストリプレット一覧の取得に失敗しました" }, { status: 500 })
  }
}

// 主語・目的語それぞれクラスかインスタンスを指定して1件作る。
// インスタンスを指定したときは、そのインスタンスのクラスで型を照合する。
// 子クラスは親クラスの宣言を継承するので、照合は継承込みで見る。
// 主語も目的語もインスタンスの組み合わせは、こちらでは受け付けない（/api/triplets の担当）。
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { projectId, predicateRelationId, objectKind, objectId } = body
    const subjectKind = body.subjectKind ?? "class"
    const subjectId = body.subjectId ?? body.subjectClassId
    if (!projectId || !subjectId || !predicateRelationId || !objectId) {
      return NextResponse.json({ error: "projectId・主語・述語・目的語は必須です" }, { status: 400 })
    }
    const kinds = [subjectKind, objectKind]
    if (kinds.some((k) => k !== "class" && k !== "instance")) {
      return NextResponse.json({ error: "主語・目的語の種類が不正です" }, { status: 400 })
    }
    if (subjectKind === "instance" && objectKind === "instance") {
      return NextResponse.json(
        { error: "主語・目的語がどちらもインスタンスの場合は、インスタンストリプレットとして登録してください" },
        { status: 400 },
      )
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

    // クラス／インスタンスどちらの端でも、名前と「型として見るクラス」を取り出す
    const resolveEnd = async (kind: "class" | "instance", id: string, label: string) => {
      if (kind === "class") {
        const target = classes.find((c) => c.id === id)
        if (!target) return { error: `${label}クラスが見つかりません` }
        return { name: target.name, classId: target.id }
      }
      const { resource: inst } = await instContainer.item(id, id).read<OntologyInstance>()
      if (!inst || inst.projectId !== projectId) return { error: `${label}インスタンスが見つかりません` }
      if (!inst.classId) return { error: `${label}インスタンスにクラスが設定されていません` }
      return { name: inst.name, classId: inst.classId }
    }

    const subject = await resolveEnd(subjectKind, subjectId, "主語")
    if ("error" in subject) return NextResponse.json({ error: subject.error }, { status: 400 })
    const object = await resolveEnd(objectKind, objectId, "目的語")
    if ("error" in object) return NextResponse.json({ error: object.error }, { status: 400 })

    const { resource: relRaw } = await relContainer.item(predicateRelationId, predicateRelationId).read<any>()
    if (!relRaw || relRaw.projectId !== projectId) {
      return NextResponse.json({ error: "述語リレーションが見つかりません" }, { status: 400 })
    }
    const relation: OntologyRelation = relRaw.classPairs
      ? relRaw
      : { ...relRaw, classPairs: [{ sourceClassId: relRaw.sourceClassId, targetClassId: relRaw.targetClassId }] }

    if (!relationAllowsPair(relation, subject.classId, object.classId, classes)) {
      return NextResponse.json(
        {
          error: `型矛盾：〈${subject.name}〉→〈${object.name}〉の組み合わせは、リレーション「${relation.name}」の許可クラスペアに含まれていません。`,
        },
        { status: 400 },
      )
    }

    const { resources: dups } = await container.items
      .query<{ id: string }>({
        query:
          "SELECT c.id FROM c WHERE c.projectId = @p AND (c.subjectId = @s OR c.subjectClassId = @s) AND c.predicateRelationId = @r AND c.objectId = @o",
        parameters: [
          { name: "@p", value: projectId },
          { name: "@s", value: subjectId },
          { name: "@r", value: predicateRelationId },
          { name: "@o", value: objectId },
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
    const item: ClassTriplet = {
      id: crypto.randomUUID(),
      projectId,
      subjectKind,
      subjectId,
      predicateRelationId,
      objectKind,
      objectId,
      subjectName: subject.name,
      predicateName: relation.name,
      objectName: object.name,
      conditions: normalizeTripletConditions(body.conditions),
      createdBy: actor,
      updatedBy: actor,
      createdAt: now,
      updatedAt: now,
    }
    const { resource } = await container.items.create(item)
    return NextResponse.json(resource, { status: 201 })
  } catch (error) {
    console.error("POST /api/class-triplets:", error)
    return NextResponse.json({ error: "トリプレットの作成に失敗しました" }, { status: 500 })
  }
}
