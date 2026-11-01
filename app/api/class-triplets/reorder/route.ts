import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { checkProjectAccess } from "@/lib/project-access"
import type { ClassTriplet } from "@/lib/types"

// クラスを含むトリプレットの並び順の更新。/api/triplets/reorder と同じ方針
// （疎な order、確認履歴と更新日時には触れない）。
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

    const container = await getContainer("classTriplets")
    const results = await Promise.all(
      updates.map(async ({ id, order }) => {
        const { resource: existing } = await container.item(id, id).read<ClassTriplet>()
        if (!existing || existing.projectId !== projectId) return false
        await container.item(id, id).replace({ ...existing, order })
        return true
      }),
    )
    return NextResponse.json({ updated: results.filter(Boolean).length })
  } catch (error) {
    console.error("POST /api/class-triplets/reorder:", error)
    return NextResponse.json({ error: "トリプレットの並び順の更新に失敗しました" }, { status: 500 })
  }
}
