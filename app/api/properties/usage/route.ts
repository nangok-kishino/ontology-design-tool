import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { checkProjectAccess } from "@/lib/project-access"
import { CONTAINERS } from "@/lib/graph-types"

// プロパティ名ごとの「値が入っている件数」。値は名前で引くので、集計も名前単位になる。
// 一覧の「値」列と、削除するときに何件消えるかの表示に使う。
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get("projectId")
    if (!projectId) return NextResponse.json({ error: "projectId が必要です" }, { status: 400 })
    const access = await checkProjectAccess(request, projectId)
    if ("error" in access) return access.error

    const count = async (containerId: string) => {
      const container = await getContainer(containerId)
      const { resources } = await container.items
        .query<{ properties?: Record<string, string> }>({
          query: "SELECT c.properties FROM c WHERE c.projectId = @p AND IS_DEFINED(c.properties)",
          parameters: [{ name: "@p", value: projectId }],
        })
        .fetchAll()
      const out: Record<string, number> = {}
      for (const r of resources) {
        for (const k of Object.keys(r.properties ?? {})) out[k] = (out[k] ?? 0) + 1
      }
      return out
    }

    const [nodes, relationships] = await Promise.all([
      count(CONTAINERS.nodes),
      count(CONTAINERS.relationships),
    ])
    return NextResponse.json({ nodes, relationships })
  } catch (error) {
    console.error("GET /api/properties/usage:", error)
    return NextResponse.json({ error: "プロパティ値の件数取得に失敗しました" }, { status: 500 })
  }
}
