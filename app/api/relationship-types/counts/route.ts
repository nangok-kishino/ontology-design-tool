import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { checkProjectAccess } from "@/lib/project-access"
import { CONTAINERS, type Relationship } from "@/lib/graph-types"

// リレーションシップタイプごとの、そのタイプを使っているリレーションシップの件数。
// 一覧の件数表示と、削除できるかどうかの判定に使う。
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get("projectId")
    if (!projectId) return NextResponse.json({ error: "projectId が必要です" }, { status: 400 })
    const access = await checkProjectAccess(request, projectId)
    if ("error" in access) return access.error

    const container = await getContainer(CONTAINERS.relationships)
    const { resources } = await container.items
      .query<Pick<Relationship, "relTypeId">>({
        query: "SELECT c.relTypeId FROM c WHERE c.projectId = @p",
        parameters: [{ name: "@p", value: projectId }],
      })
      .fetchAll()

    const counts: Record<string, number> = {}
    for (const r of resources) {
      if (r.relTypeId) counts[r.relTypeId] = (counts[r.relTypeId] ?? 0) + 1
    }
    return NextResponse.json({ counts })
  } catch (error) {
    console.error("GET /api/relationship-types/counts:", error)
    return NextResponse.json({ error: "リレーションシップ件数の取得に失敗しました" }, { status: 500 })
  }
}
