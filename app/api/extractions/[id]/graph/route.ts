// 同じ文書でグラフデータ抽出をやり直す（スキーマ候補を登録したあと、新しいラベル・タイプを使うため）。
// 実行済みの候補は残し、未処理のノード・リレーションシップ候補だけを新しい結果で置き換える。

import { NextRequest, NextResponse } from "next/server"
import { checkProjectAccess } from "@/lib/project-access"
import { extractGraph } from "@/lib/llm-analysis"
import { extractionContainer, loadGraphContext, withoutText } from "@/lib/llm-analysis-server"
import type { Extraction } from "@/lib/llm-analysis-types"

export const maxDuration = 300

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const container = await extractionContainer()
    const { resource } = await container.item(id, id).read<Extraction>()
    if (!resource) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const access = await checkProjectAccess(request, resource.projectId)
    if ("error" in access) return access.error
    if (!resource.text) return NextResponse.json({ error: "この解析結果には文書の本文が残っていません" }, { status: 400 })

    const result = await extractGraph(resource.text, await loadGraphContext(resource.projectId))
    const now = new Date().toISOString()
    const next: Extraction = {
      ...resource,
      targets: { ...resource.targets, graph: true },
      nodes: [...resource.nodes.filter((c) => c.status === "done"), ...result.nodes],
      relationships: [...resource.relationships.filter((c) => c.status === "done"), ...result.relationships],
      notes: [...resource.notes.filter((n) => !n.startsWith("［グラフ］")), ...result.notes.map((n) => `［グラフ］${n}`)],
      graphExtractedAt: now,
      updatedAt: now,
    }
    const { resource: saved } = await container.item(id, id).replace(next)
    return NextResponse.json(withoutText(saved ?? next))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("POST /api/extractions/[id]/graph:", message)
    return NextResponse.json({ error: `グラフデータ抽出に失敗しました：${message}` }, { status: 500 })
  }
}
