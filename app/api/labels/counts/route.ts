import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { checkProjectAccess } from "@/lib/project-access"
import { CONTAINERS, type GraphNode } from "@/lib/graph-types"

// ラベルごとのノード件数。1ノードが複数のラベルを持つので、合計はノード総数と一致しない。
// 一覧の件数表示と、削除時に「何件のノードからラベルが外れるか」を出すのに使う。
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get("projectId")
    if (!projectId) return NextResponse.json({ error: "projectId が必要です" }, { status: 400 })
    const access = await checkProjectAccess(request, projectId)
    if ("error" in access) return access.error

    const container = await getContainer(CONTAINERS.nodes)
    const { resources } = await container.items
      .query<Pick<GraphNode, "labelIds" | "status">>({
        query: "SELECT c.labelIds, c.status FROM c WHERE c.projectId = @p",
        parameters: [{ name: "@p", value: projectId }],
      })
      .fetchAll()

    const counts: Record<string, number> = {}
    let unlabeled = 0
    for (const n of resources) {
      // 統合済み（名寄せで不採用になった側）は数えない
      if (n.status === "merged") continue
      const ids = n.labelIds ?? []
      if (ids.length === 0) unlabeled++
      for (const id of ids) counts[id] = (counts[id] ?? 0) + 1
    }
    return NextResponse.json({ counts, unlabeled })
  } catch (error) {
    console.error("GET /api/labels/counts:", error)
    return NextResponse.json({ error: "ノード件数の取得に失敗しました" }, { status: 500 })
  }
}
