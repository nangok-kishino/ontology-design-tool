import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { checkProjectAccess } from "@/lib/project-access"
import { CONTAINERS, type NodeNameResolution } from "@/lib/graph-types"

// 名寄せ辞書の参照。確定した「別名 → 代表ノード」の対応が1件＝1レコードで入っている。
// 書き込みは /api/nodes/resolve だけが行う（確定の単一出口）。
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get("projectId")
    const canonicalNodeId = searchParams.get("canonicalNodeId")
    if (!projectId) return NextResponse.json({ error: "projectId が必要です" }, { status: 400 })
    const access = await checkProjectAccess(request, projectId)
    if ("error" in access) return access.error

    const container = await getContainer(CONTAINERS.nodeNameResolutions)
    const { resources } = await container.items
      .query<NodeNameResolution>({
        query: "SELECT * FROM c WHERE c.projectId = @p",
        parameters: [{ name: "@p", value: projectId }],
      })
      .fetchAll()

    return NextResponse.json(
      canonicalNodeId ? resources.filter((r) => r.canonicalNodeId === canonicalNodeId) : resources,
    )
  } catch (error) {
    console.error("GET /api/node-resolutions:", error)
    return NextResponse.json({ error: "名寄せ辞書の取得に失敗しました" }, { status: 500 })
  }
}
