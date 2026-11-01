import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { getPrincipalName } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/project-access"
import { CONTAINERS, type GraphNode, type Relationship, type RelationshipType } from "@/lib/graph-types"

const CONTAINER = CONTAINERS.relationships

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get("projectId")
    const relTypeId = searchParams.get("relTypeId")
    const nodeId = searchParams.get("nodeId")
    if (!projectId) return NextResponse.json({ error: "projectId が必要です" }, { status: 400 })
    const access = await checkProjectAccess(request, projectId)
    if ("error" in access) return access.error

    const container = await getContainer(CONTAINER)
    const { resources } = await container.items
      .query<Relationship>({
        query: "SELECT * FROM c WHERE c.projectId = @p",
        parameters: [{ name: "@p", value: projectId }],
      })
      .fetchAll()

    let rows = resources
    if (relTypeId) rows = rows.filter((r) => r.relTypeId === relTypeId)
    if (nodeId) rows = rows.filter((r) => r.startNodeId === nodeId || r.endNodeId === nodeId)
    return NextResponse.json(rows)
  } catch (error) {
    console.error("GET /api/relationships:", error)
    return NextResponse.json({ error: "リレーションシップ一覧の取得に失敗しました" }, { status: 500 })
  }
}

// 【ラベルペアに合わない組み合わせは拒否せず、警告として残す】
//   ラベルの階層が無くなったため、上位ラベルの付け忘れで「本当は正しいのに弾かれる」ことが起こりうる。
//   弾くより、作らせたうえで画面で目立たせたほうが取りこぼしが少ない（docs/graph-model.md §3-2）。
//   同じ (始点・タイプ・終点) の重複だけは 409 で止める。
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    if (!body.projectId) return NextResponse.json({ error: "projectId が必要です" }, { status: 400 })
    const access = await checkProjectAccess(request, body.projectId)
    if ("error" in access) return access.error

    const { startNodeId, relTypeId, endNodeId } = body
    if (!startNodeId || !relTypeId || !endNodeId) {
      return NextResponse.json({ error: "始点ノード・タイプ・終点ノードを選んでください" }, { status: 400 })
    }

    const [nodeContainer, typeContainer, container] = await Promise.all([
      getContainer(CONTAINERS.nodes),
      getContainer(CONTAINERS.relationshipTypes),
      getContainer(CONTAINER),
    ])
    const [startRes, endRes, typeRes] = await Promise.all([
      nodeContainer.item(startNodeId, startNodeId).read<GraphNode>(),
      nodeContainer.item(endNodeId, endNodeId).read<GraphNode>(),
      typeContainer.item(relTypeId, relTypeId).read<RelationshipType>(),
    ])
    const start = startRes.resource
    const end = endRes.resource
    const relType = typeRes.resource
    if (!start || !end || !relType) {
      return NextResponse.json({ error: "指定されたノードまたはタイプが見つかりません" }, { status: 400 })
    }
    if (start.status === "merged" || end.status === "merged") {
      return NextResponse.json({ error: "統合済みのノードは使えません" }, { status: 409 })
    }

    const { resources: dupes } = await container.items
      .query<Relationship>({
        query:
          "SELECT c.id FROM c WHERE c.projectId = @p AND c.startNodeId = @s AND c.relTypeId = @t AND c.endNodeId = @e",
        parameters: [
          { name: "@p", value: body.projectId },
          { name: "@s", value: startNodeId },
          { name: "@t", value: relTypeId },
          { name: "@e", value: endNodeId },
        ],
      })
      .fetchAll()
    if (dupes.length > 0) {
      return NextResponse.json({ error: "同じ組み合わせのリレーションシップが既にあります" }, { status: 409 })
    }

    const now = new Date().toISOString()
    const actor = getPrincipalName(request)
    const item: Relationship = {
      id: crypto.randomUUID(),
      projectId: body.projectId,
      startNodeId,
      relTypeId,
      endNodeId,
      startNodeName: start.name,
      startNodeLabelIds: start.labelIds ?? [],
      relTypeName: relType.name,
      endNodeName: end.name,
      endNodeLabelIds: end.labelIds ?? [],
      properties: body.properties ?? undefined,
      conditions: body.conditions ?? undefined,
      sourceDocName: body.sourceDocName,
      evidence: body.evidence,
      sourceCandidateId: body.sourceCandidateId,
      order: body.order,
      approvedBy: actor,
      approvedAt: now,
      createdBy: actor,
      createdAt: now,
      updatedBy: actor,
      updatedAt: now,
    }
    const { resource } = await container.items.create(item)
    return NextResponse.json(resource, { status: 201 })
  } catch (error) {
    console.error("POST /api/relationships:", error)
    return NextResponse.json({ error: "リレーションシップの作成に失敗しました" }, { status: 500 })
  }
}
