import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { getPrincipalName } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/project-access"
import { relationAllowsPair } from "@/lib/triplet-resolve"
import { normalizeTripletConditions } from "@/lib/relation-conditions"
import { appendEditEvent } from "@/lib/confirmation"
import type { ClassTriplet, OntologyClass, OntologyInstance, OntologyRelation } from "@/lib/types"

const CONTAINER = "classTriplets"

// 主語がクラス固定だった頃のデータを今の形に読み替える
function normalize(raw: any): ClassTriplet {
  if (raw?.subjectKind) return raw as ClassTriplet
  return { ...raw, subjectKind: "class", subjectId: raw.subjectClassId }
}

function diffFields(before: ClassTriplet, after: ClassTriplet): string[] {
  const changed: string[] = []
  if (before.subjectKind !== after.subjectKind || before.subjectId !== after.subjectId) changed.push("subjectId")
  if (before.predicateRelationId !== after.predicateRelationId) changed.push("predicateRelationId")
  if (before.objectKind !== after.objectKind || before.objectId !== after.objectId) changed.push("objectId")
  if (JSON.stringify(before.conditions ?? {}) !== JSON.stringify(after.conditions ?? {})) changed.push("conditions")
  return changed
}

// 主語・述語・目的語の差し替えと成立条件の更新。
// 検証は作成時（POST /api/class-triplets）と同じ：クラスペアの整合を継承込みで見て、
// 主語も目的語もインスタンスの組み合わせはここでは受け付けない（/api/triplets の担当）。
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const container = await getContainer(CONTAINER)
    const { resource: raw } = await container.item(id, id).read<any>()
    if (!raw) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const existing = normalize(raw)
    const access = await checkProjectAccess(request, existing.projectId)
    if ("error" in access) return access.error
    const projectId = existing.projectId

    const subjectKind: "class" | "instance" = body.subjectKind ?? existing.subjectKind
    const subjectId: string = body.subjectId ?? existing.subjectId
    const predicateRelationId: string = body.predicateRelationId ?? existing.predicateRelationId
    const objectKind: "class" | "instance" = body.objectKind ?? existing.objectKind
    const objectId: string = body.objectId ?? existing.objectId

    if ([subjectKind, objectKind].some((k) => k !== "class" && k !== "instance")) {
      return NextResponse.json({ error: "主語・目的語の種類が不正です" }, { status: 400 })
    }
    if (subjectKind === "instance" && objectKind === "instance") {
      return NextResponse.json(
        { error: "主語・目的語がどちらもインスタンスの場合は、インスタンストリプレットとして登録してください" },
        { status: 400 },
      )
    }

    const [classContainer, relContainer, instContainer] = await Promise.all([
      getContainer("classes"),
      getContainer("relations"),
      getContainer("instances"),
    ])
    const { resources: classes } = await classContainer.items
      .query<OntologyClass>({
        query: "SELECT * FROM c WHERE c.projectId = @p",
        parameters: [{ name: "@p", value: projectId }],
      })
      .fetchAll()

    // クラス／インスタンスどちらの端でも、名前と「型として見るクラス」を取り出す
    const resolveEnd = async (kind: "class" | "instance", endId: string, label: string) => {
      if (kind === "class") {
        const target = classes.find((c) => c.id === endId)
        if (!target) return { error: `${label}クラスが見つかりません` }
        return { name: target.name, classId: target.id }
      }
      const { resource: inst } = await instContainer.item(endId, endId).read<OntologyInstance>()
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

    const spoChanged =
      subjectKind !== existing.subjectKind ||
      subjectId !== existing.subjectId ||
      predicateRelationId !== existing.predicateRelationId ||
      objectKind !== existing.objectKind ||
      objectId !== existing.objectId
    if (spoChanged) {
      const { resources: dups } = await container.items
        .query<{ id: string }>({
          query:
            "SELECT c.id FROM c WHERE c.projectId = @p AND (c.subjectId = @s OR c.subjectClassId = @s) AND c.predicateRelationId = @r AND c.objectId = @o AND c.id != @id",
          parameters: [
            { name: "@p", value: projectId },
            { name: "@s", value: subjectId },
            { name: "@r", value: predicateRelationId },
            { name: "@o", value: objectId },
            { name: "@id", value: id },
          ],
        })
        .fetchAll()
      if (dups.length > 0) {
        return NextResponse.json(
          { error: `同一のトリプレット（〈${subject.name}〉→「${relation.name}」→〈${object.name}〉）が既に登録されています。` },
          { status: 409 },
        )
      }
    }

    const actor = getPrincipalName(request)
    const merged: ClassTriplet = {
      ...existing,
      subjectKind,
      subjectId,
      predicateRelationId,
      objectKind,
      objectId,
      subjectName: subject.name,
      predicateName: relation.name,
      objectName: object.name,
      conditions:
        body.conditions === undefined ? existing.conditions ?? {} : normalizeTripletConditions(body.conditions),
      updatedBy: actor,
      updatedAt: new Date().toISOString(),
    }
    const changedFields = diffFields(existing, merged)
    const updated: ClassTriplet = {
      ...merged,
      confirmations: appendEditEvent(existing.confirmations, actor, changedFields, merged.updatedAt),
    }
    // 主語がクラス固定だった頃の名残は残さない
    delete (updated as any).subjectClassId
    const { resource } = await container.item(id, id).replace(updated)
    return NextResponse.json(resource)
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("PUT /api/class-triplets/[id]:", error)
    return NextResponse.json({ error: "トリプレットの更新に失敗しました" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const container = await getContainer(CONTAINER)
    const { resource: existing } = await container.item(id, id).read<ClassTriplet>()
    if (!existing) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const access = await checkProjectAccess(request, existing.projectId)
    if ("error" in access) return access.error
    await container.item(id, id).delete()
    return new NextResponse(null, { status: 204 })
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("DELETE /api/class-triplets/[id]:", error)
    return NextResponse.json({ error: "クラストリプレットの削除に失敗しました" }, { status: 500 })
  }
}
