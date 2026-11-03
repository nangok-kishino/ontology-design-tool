import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { getPrincipalName } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/project-access"
import { appendEditEvent, appendUnconfirmEvent, deriveConfirmationStatus } from "@/lib/confirmation"
import {
  CONTAINERS, conditionSetsOf, normalizeConditionSets, type GraphNode, type Relationship,
} from "@/lib/graph-types"

const CONTAINER = CONTAINERS.relationships

// 編集で確認履歴の [edit] を積むべきフィールド。order は整理の都合なので含めない。
function diffFields(before: Relationship, after: Relationship): string[] {
  const changed: string[] = []
  if (before.startNodeId !== after.startNodeId) changed.push("startNode")
  if (before.endNodeId !== after.endNodeId) changed.push("endNode")
  if (JSON.stringify(before.properties ?? {}) !== JSON.stringify(after.properties ?? {})) {
    changed.push("properties")
  }
  if (JSON.stringify(conditionSetsOf(before)) !== JSON.stringify(conditionSetsOf(after))) {
    changed.push("conditions")
  }
  if ((before.evidence ?? "") !== (after.evidence ?? "")) changed.push("evidence")
  return changed
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const container = await getContainer(CONTAINER)
    const { resource } = await container.item(id, id).read<Relationship>()
    if (!resource) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const access = await checkProjectAccess(request, resource.projectId)
    if ("error" in access) return access.error
    return NextResponse.json(resource)
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("GET /api/relationships/[id]:", error)
    return NextResponse.json({ error: "リレーションシップの取得に失敗しました" }, { status: 500 })
  }
}

// 【始点・終点の付け替え】終点を間違えた、などを直すたびに作り直すと、入力済みの根拠・成立条件・
//   プロパティと一覧の並びを失うため、始点・終点は付け替えられるようにする。そのとき
//   ・名前・ラベルのスナップショットは付け替え先のノードで取り直す
//   ・確認済みでも「未確認」に戻す（確認したのは元の組み合わせなので）。履歴には [edit] を残す
//   ・追加と同じく、同じ (始点・タイプ・終点) が既にあれば 409 で止める
// 【タイプは付け替えさせない】成立条件・プロパティはタイプごとの定義なので、変えると中身が合わなくなる。
//   タイプを変えたいときは作り直してもらう。
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const container = await getContainer(CONTAINER)
    const { resource: existing } = await container.item(id, id).read<Relationship>()
    if (!existing) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const access = await checkProjectAccess(request, existing.projectId)
    if ("error" in access) return access.error

    // 始点・終点の付け替え（指定があって、今と違うときだけ）
    const nextStartId: string = body.startNodeId || existing.startNodeId
    const nextEndId: string = body.endNodeId || existing.endNodeId
    const ends: Partial<Relationship> = {}
    if (nextStartId !== existing.startNodeId || nextEndId !== existing.endNodeId) {
      const nodeContainer = await getContainer(CONTAINERS.nodes)
      const [startRes, endRes] = await Promise.all([
        nodeContainer.item(nextStartId, nextStartId).read<GraphNode>(),
        nodeContainer.item(nextEndId, nextEndId).read<GraphNode>(),
      ])
      const start = startRes.resource
      const end = endRes.resource
      if (!start || !end || start.projectId !== existing.projectId || end.projectId !== existing.projectId) {
        return NextResponse.json({ error: "指定されたノードが見つかりません" }, { status: 400 })
      }
      const changedNodes = [
        nextStartId !== existing.startNodeId ? start : null,
        nextEndId !== existing.endNodeId ? end : null,
      ]
      if (changedNodes.some((n) => n?.status === "merged")) {
        return NextResponse.json({ error: "統合済みのノードは使えません" }, { status: 409 })
      }
      const { resources: dupes } = await container.items
        .query<Relationship>({
          query:
            "SELECT c.id FROM c WHERE c.projectId = @p AND c.startNodeId = @s AND c.relTypeId = @t AND c.endNodeId = @e AND c.id != @id",
          parameters: [
            { name: "@p", value: existing.projectId },
            { name: "@s", value: nextStartId },
            { name: "@t", value: existing.relTypeId },
            { name: "@e", value: nextEndId },
            { name: "@id", value: id },
          ],
        })
        .fetchAll()
      if (dupes.length > 0) {
        return NextResponse.json({ error: "同じ組み合わせのリレーションシップが既にあります" }, { status: 409 })
      }
      Object.assign(ends, {
        startNodeId: nextStartId,
        startNodeName: start.name,
        startNodeLabelIds: start.labelIds ?? [],
        endNodeId: nextEndId,
        endNodeName: end.name,
        endNodeLabelIds: end.labelIds ?? [],
      })
    }

    const actor = getPrincipalName(request)
    const merged: Relationship = {
      ...existing,
      ...ends,
      properties: body.properties !== undefined ? body.properties : existing.properties,
      // 成立条件は条件セットで受け取り、旧形式の conditions は消す（conditionSetsOf が両方を読むため）
      conditionSets: body.conditionSets !== undefined
        ? normalizeConditionSets(body.conditionSets)
        : conditionSetsOf(existing),
      conditions: undefined,
      evidence: body.evidence !== undefined ? body.evidence : existing.evidence,
      updatedBy: actor,
      updatedAt: new Date().toISOString(),
    }
    let confirmations = appendEditEvent(
      existing.confirmations,
      actor,
      diffFields(existing, merged),
      merged.updatedAt,
    )
    // 端を付け替えたら、確認は元の組み合わせに対するものなので未確認に戻す
    if (ends.startNodeId && deriveConfirmationStatus(confirmations).state !== "unconfirmed") {
      confirmations = appendUnconfirmEvent(confirmations, actor, merged.updatedAt)
    }
    const updated: Relationship = { ...merged, confirmations }
    const { resource } = await container.item(id, id).replace(updated)
    return NextResponse.json(resource)
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("PUT /api/relationships/[id]:", error)
    return NextResponse.json({ error: "リレーションシップの更新に失敗しました" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const container = await getContainer(CONTAINER)
    const { resource: existing } = await container.item(id, id).read<Relationship>()
    if (!existing) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const access = await checkProjectAccess(request, existing.projectId)
    if ("error" in access) return access.error
    await container.item(id, id).delete()
    return new NextResponse(null, { status: 204 })
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("DELETE /api/relationships/[id]:", error)
    return NextResponse.json({ error: "リレーションシップの削除に失敗しました" }, { status: 500 })
  }
}
