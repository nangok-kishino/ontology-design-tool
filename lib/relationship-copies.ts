// リレーションシップには、始点・終点ノードの名前とラベル、タイプ名の写しを持たせている
// （一覧の表示と Cypher の書き出しで使う）。元のノードやタイプを直したら、写しも合わせる。
//
// 写しを直すだけなので、リレーションシップの updatedAt や確認履歴は動かさない。
// リレーションシップそのものを編集したわけではないため。

import { getContainer } from "@/lib/cosmos"
import { CONTAINERS, type GraphNode, type Relationship, type RelationshipType } from "@/lib/graph-types"

const sameIds = (a: string[] | undefined, b: string[] | undefined) =>
  JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort())

// ノードの名前・ラベルが変わったときに呼ぶ
export async function syncNodeCopies(node: GraphNode): Promise<void> {
  const container = await getContainer(CONTAINERS.relationships)
  const { resources } = await container.items
    .query<Relationship>({
      query: "SELECT * FROM c WHERE c.projectId = @p AND (c.startNodeId = @id OR c.endNodeId = @id)",
      parameters: [{ name: "@p", value: node.projectId }, { name: "@id", value: node.id }],
    })
    .fetchAll()
  const labelIds = node.labelIds ?? []
  for (const r of resources) {
    const next = { ...r }
    if (r.startNodeId === node.id) { next.startNodeName = node.name; next.startNodeLabelIds = labelIds }
    if (r.endNodeId === node.id) { next.endNodeName = node.name; next.endNodeLabelIds = labelIds }
    if (
      next.startNodeName === r.startNodeName && next.endNodeName === r.endNodeName &&
      sameIds(next.startNodeLabelIds, r.startNodeLabelIds) && sameIds(next.endNodeLabelIds, r.endNodeLabelIds)
    ) continue
    await container.item(r.id, r.id).replace(next)
  }
}

// リレーションシップタイプの名前が変わったときに呼ぶ
export async function syncRelTypeCopies(relType: RelationshipType): Promise<void> {
  const container = await getContainer(CONTAINERS.relationships)
  const { resources } = await container.items
    .query<Relationship>({
      query: "SELECT * FROM c WHERE c.projectId = @p AND c.relTypeId = @id AND c.relTypeName != @name",
      parameters: [
        { name: "@p", value: relType.projectId },
        { name: "@id", value: relType.id },
        { name: "@name", value: relType.name },
      ],
    })
    .fetchAll()
  for (const r of resources) {
    await container.item(r.id, r.id).replace({ ...r, relTypeName: relType.name })
  }
}
