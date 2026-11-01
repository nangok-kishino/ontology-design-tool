import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { checkProjectAccess } from "@/lib/project-access"
import { CONTAINERS, type GraphNode } from "@/lib/graph-types"

// ノードの並び順だけを更新する。ノードはグループを持たないので、
// ラベル／リレーションシップタイプの reorder とは別の単純なハンドラにしてある。
//
// 並び順は整理の都合なので、確認履歴にも updatedAt にも触らない。
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const projectId: string | undefined = body.projectId
    const updates: { id: string; order: number }[] = body.updates
    if (!projectId) return NextResponse.json({ error: "projectId が必要です" }, { status: 400 })
    if (!Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json({ error: "updates は空でない配列が必要です" }, { status: 400 })
    }
    if (updates.some((u) => typeof u?.id !== "string" || typeof u?.order !== "number")) {
      return NextResponse.json({ error: "updates の形式が不正です" }, { status: 400 })
    }
    const access = await checkProjectAccess(request, projectId)
    if ("error" in access) return access.error

    const container = await getContainer(CONTAINERS.nodes)
    const results = await Promise.all(
      updates.map(async ({ id, order }) => {
        const { resource: existing } = await container.item(id, id).read<GraphNode>()
        // 他プロジェクトのものは触らない
        if (!existing || existing.projectId !== projectId) return false
        await container.item(id, id).replace({ ...existing, order })
        return true
      }),
    )
    return NextResponse.json({ updated: results.filter(Boolean).length })
  } catch (error) {
    console.error("POST /api/nodes/reorder:", error)
    return NextResponse.json({ error: "ノードの並び順の更新に失敗しました" }, { status: 500 })
  }
}
