import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { checkProjectAccess } from "@/lib/project-access"
import type { NameResolution } from "@/lib/types"

const CONTAINER = "nameResolutions"

// 名寄せ辞書の参照。確定した名寄せ結果（別名→代表の対応）を返す。
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get("projectId")
    if (!projectId) {
      return NextResponse.json({ error: "projectId が必要です" }, { status: 400 })
    }
    const access = await checkProjectAccess(request, projectId)
    if ("error" in access) return access.error

    const container = await getContainer(CONTAINER)
    const { resources } = await container.items
      .query<NameResolution>({
        query: "SELECT * FROM c WHERE c.projectId = @projectId",
        parameters: [{ name: "@projectId", value: projectId }],
      })
      .fetchAll()
    return NextResponse.json(resources)
  } catch (error) {
    console.error("GET /api/name-resolutions:", error)
    return NextResponse.json({ error: "名寄せ辞書の取得に失敗しました" }, { status: 500 })
  }
}
