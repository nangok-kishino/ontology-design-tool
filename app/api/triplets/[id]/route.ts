import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { getPrincipalName } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/project-access"
import { isConfirmed } from "@/lib/instance-status"
import { relationAllowsPair } from "@/lib/triplet-resolve"
import type { Triplet, OntologyInstance, OntologyRelation } from "@/lib/types"

const CONTAINER = "triplets"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const container = await getContainer(CONTAINER)
    const { resource } = await container.item(id, id).read<Triplet>()
    if (!resource) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const access = await checkProjectAccess(request, resource.projectId)
    if ("error" in access) return access.error
    return NextResponse.json(resource)
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("GET /api/triplets/[id]:", error)
    return NextResponse.json({ error: "トリプレットの取得に失敗しました" }, { status: 500 })
  }
}

// 主語・述語・目的語の差し替え。差し替え時も本登録＋クラスペア整合を再検証する。
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const container = await getContainer(CONTAINER)
    const { resource: existing } = await container.item(id, id).read<Triplet>()
    if (!existing) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const access = await checkProjectAccess(request, existing.projectId)
    if ("error" in access) return access.error

    const subjectInstanceId = body.subjectInstanceId ?? existing.subjectInstanceId
    const predicateRelationId = body.predicateRelationId ?? existing.predicateRelationId
    const objectInstanceId = body.objectInstanceId ?? existing.objectInstanceId

    const [instContainer, relContainer] = await Promise.all([
      getContainer("instances"),
      getContainer("relations"),
    ])
    const [{ resource: subject }, { resource: object }, { resource: relRaw }] = await Promise.all([
      instContainer.item(subjectInstanceId, subjectInstanceId).read<OntologyInstance>(),
      instContainer.item(objectInstanceId, objectInstanceId).read<OntologyInstance>(),
      relContainer.item(predicateRelationId, predicateRelationId).read<any>(),
    ])
    if (!subject || subject.projectId !== existing.projectId) {
      return NextResponse.json({ error: "主語インスタンスが見つかりません" }, { status: 400 })
    }
    if (!object || object.projectId !== existing.projectId) {
      return NextResponse.json({ error: "目的語インスタンスが見つかりません" }, { status: 400 })
    }
    if (!relRaw || relRaw.projectId !== existing.projectId) {
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
          error: `型矛盾：〈${subject.name}〉→〈${object.name}〉の組み合わせは、リレーション「${relation.name}」の許可クラスペアに含まれていません。`,
        },
        { status: 400 },
      )
    }

    // 主語・述語・目的語のいずれかが変わる場合、他の同一トリプレットと重複しないか検証
    const spoChanged =
      subjectInstanceId !== existing.subjectInstanceId ||
      predicateRelationId !== existing.predicateRelationId ||
      objectInstanceId !== existing.objectInstanceId
    if (spoChanged) {
      const { resources: dups } = await container.items
        .query<Triplet>({
          query:
            "SELECT c.id FROM c WHERE c.projectId = @p AND c.subjectInstanceId = @s AND c.predicateRelationId = @r AND c.objectInstanceId = @o AND c.id != @id",
          parameters: [
            { name: "@p", value: existing.projectId },
            { name: "@s", value: subjectInstanceId },
            { name: "@r", value: predicateRelationId },
            { name: "@o", value: objectInstanceId },
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

    const updated: Triplet = {
      ...existing,
      subjectInstanceId,
      predicateRelationId,
      objectInstanceId,
      subjectName: subject.name,
      subjectClassId: subject.classId ?? null,
      predicateName: relation.name,
      objectName: object.name,
      objectClassId: object.classId ?? null,
      sourceDocName: body.sourceDocName ?? existing.sourceDocName,
      evidence: body.evidence ?? existing.evidence,
      attributes: body.attributes ?? existing.attributes ?? {},
      // 内容が変わったので同期状態はリセット（再エクスポートで冪等に反映）
      neo4jSynced: false,
      neo4jSyncedAt: undefined,
      updatedBy: getPrincipalName(request),
      updatedAt: new Date().toISOString(),
    }
    const { resource } = await container.item(id, id).replace(updated)
    return NextResponse.json(resource)
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("PUT /api/triplets/[id]:", error)
    return NextResponse.json({ error: "トリプレットの更新に失敗しました" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const container = await getContainer(CONTAINER)
    const { resource: existing } = await container.item(id, id).read<Triplet>()
    if (!existing) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const access = await checkProjectAccess(request, existing.projectId)
    if ("error" in access) return access.error
    await container.item(id, id).delete()
    return new NextResponse(null, { status: 204 })
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("DELETE /api/triplets/[id]:", error)
    return NextResponse.json({ error: "トリプレットの削除に失敗しました" }, { status: 500 })
  }
}
