import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { getPrincipalName } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/project-access"
import { appendEditEvent } from "@/lib/confirmation"
import { diffLabelFields } from "@/lib/graph-confirmation"
import { cleanSynonyms, findSynonymConflict, type LabelForSynonymCheck } from "@/lib/label-synonyms"
import { CONTAINERS, type GraphNode, type Label, type PropertyDef, type RelationshipType } from "@/lib/graph-types"
import { syncNodeCopies } from "@/lib/relationship-copies"

const CONTAINER = CONTAINERS.labels

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const container = await getContainer(CONTAINER)
    const { resource } = await container.item(id, id).read<Label>()
    if (!resource) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const access = await checkProjectAccess(request, resource.projectId)
    if ("error" in access) return access.error
    return NextResponse.json(resource)
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("GET /api/labels/[id]:", error)
    return NextResponse.json({ error: "ラベルの取得に失敗しました" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const container = await getContainer(CONTAINER)
    const { resource: existing } = await container.item(id, id).read<Label>()
    if (!existing) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const access = await checkProjectAccess(request, existing.projectId)
    if ("error" in access) return access.error
    // 予約ラベルは改名させない（個体とカテゴリノードの区別に使うため）
    if (existing.system && body.name !== undefined && body.name !== existing.name) {
      return NextResponse.json({ error: "予約ラベルの名前は変更できません" }, { status: 409 })
    }

    const actor = getPrincipalName(request)
    const merged: Label = {
      ...existing,
      name: body.name ?? existing.name,
      nameEn: body.nameEn !== undefined ? body.nameEn : (existing.nameEn ?? ""),
      description: body.description ?? existing.description,
      updatedBy: actor,
      updatedAt: new Date().toISOString(),
    }
    merged.synonyms = cleanSynonyms(
      body.synonyms !== undefined ? body.synonyms : (existing.synonyms ?? []),
      merged.name,
    )
    // 同じ語が2つのラベルを指さないよう、同義語・ラベル名をプロジェクト内の他ラベルと照合する
    const { resources: siblings } = await container.items
      .query<LabelForSynonymCheck>({
        query: "SELECT c.id, c.name, c.synonyms FROM c WHERE c.projectId = @projectId",
        parameters: [{ name: "@projectId", value: existing.projectId }],
      })
      .fetchAll()
    const conflict = findSynonymConflict(siblings, id, merged.name, merged.synonyms)
    if (conflict) return NextResponse.json({ error: conflict }, { status: 409 })

    const updated: Label = {
      ...merged,
      confirmations: appendEditEvent(
        existing.confirmations,
        actor,
        diffLabelFields(existing, merged),
        merged.updatedAt,
      ),
    }
    const { resource } = await container.item(id, id).replace(updated)
    return NextResponse.json(resource)
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("PUT /api/labels/[id]:", error)
    return NextResponse.json({ error: "ラベルの更新に失敗しました" }, { status: 500 })
  }
}

// ラベルを消すときは、参照している側からも取り除く。
//   ノード        : labelIds からこのラベルを外す（ノード自体は消さない）
//   リレーションシップタイプ : このラベルを端点に持つラベルペアを外す
//   プロパティ定義 : このラベルの定義を消す（ノードの値は名前で持つので残す）
// 残しておくと「存在しないラベル」を指したままになり、掃除の手間が増えるだけなので。
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const container = await getContainer(CONTAINER)
    const { resource: existing } = await container.item(id, id).read<Label>()
    if (!existing) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const access = await checkProjectAccess(request, existing.projectId)
    if ("error" in access) return access.error
    if (existing.system) {
      return NextResponse.json({ error: "予約ラベルは削除できません" }, { status: 409 })
    }

    const nodeContainer = await getContainer(CONTAINERS.nodes)
    const { resources: nodes } = await nodeContainer.items
      .query<GraphNode>({
        query: "SELECT * FROM c WHERE c.projectId = @p AND ARRAY_CONTAINS(c.labelIds, @id)",
        parameters: [{ name: "@p", value: existing.projectId }, { name: "@id", value: id }],
      })
      .fetchAll()
    for (const n of nodes) {
      const { resource: detached } = await nodeContainer.item(n.id, n.id)
        .replace<GraphNode>({ ...n, labelIds: n.labelIds.filter((l) => l !== id) })
      if (detached) await syncNodeCopies(detached)
    }

    const propContainer = await getContainer(CONTAINERS.propertyDefs)
    const { resources: defs } = await propContainer.items
      .query<Pick<PropertyDef, "id">>({
        query: "SELECT c.id FROM c WHERE c.projectId = @p AND c.targetType = 'label' AND c.targetId = @id",
        parameters: [{ name: "@p", value: existing.projectId }, { name: "@id", value: id }],
      })
      .fetchAll()
    for (const d of defs) await propContainer.item(d.id, d.id).delete()

    const relTypeContainer = await getContainer(CONTAINERS.relationshipTypes)
    const { resources: relTypes } = await relTypeContainer.items
      .query<RelationshipType>({
        query: "SELECT * FROM c WHERE c.projectId = @p",
        parameters: [{ name: "@p", value: existing.projectId }],
      })
      .fetchAll()
    for (const rt of relTypes) {
      const kept = (rt.labelPairs ?? []).filter((p) => p.sourceLabelId !== id && p.targetLabelId !== id)
      if (kept.length !== (rt.labelPairs ?? []).length) {
        await relTypeContainer.item(rt.id, rt.id).replace({ ...rt, labelPairs: kept })
      }
    }

    await container.item(id, id).delete()
    return NextResponse.json({ detachedNodes: nodes.length })
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("DELETE /api/labels/[id]:", error)
    return NextResponse.json({ error: "ラベルの削除に失敗しました" }, { status: 500 })
  }
}
