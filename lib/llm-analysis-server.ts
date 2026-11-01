// LLMによる解析の API ルートで共通に使う、保存とプロジェクトデータの読み込み。

import { getContainer } from "@/lib/cosmos"
import {
  CONTAINERS,
  type GraphNode, type Label, type PropertyDef, type Relationship, type RelationshipType,
} from "@/lib/graph-types"
import type { Extraction } from "@/lib/llm-analysis-types"
import type { GraphContext } from "@/lib/llm-analysis"

async function byProject<T>(containerId: string, projectId: string): Promise<T[]> {
  const container = await getContainer(containerId)
  const { resources } = await container.items
    .query<T>({ query: "SELECT * FROM c WHERE c.projectId = @p", parameters: [{ name: "@p", value: projectId }] })
    .fetchAll()
  return resources
}

export async function loadGraphContext(projectId: string): Promise<GraphContext> {
  const [labels, relTypes, nodes, relationships, propertyDefs] = await Promise.all([
    byProject<Label>(CONTAINERS.labels, projectId),
    byProject<RelationshipType>(CONTAINERS.relationshipTypes, projectId),
    byProject<GraphNode>(CONTAINERS.nodes, projectId),
    byProject<Relationship>(CONTAINERS.relationships, projectId),
    byProject<PropertyDef>(CONTAINERS.propertyDefs, projectId),
  ])
  return { labels, relTypes, nodes, relationships, propertyDefs }
}

// 応答には本文（text）を含めない。大きいうえに画面では使わないため。
export function withoutText(e: Extraction): Extraction {
  const { text: _text, ...rest } = e
  return rest
}

export async function extractionContainer() {
  return getContainer(CONTAINERS.extractions)
}

// Cosmos の1件の上限（2MB）に収まるよう、保存できる本文の長さを決めておく
export const MAX_TEXT_CHARS = 500000
