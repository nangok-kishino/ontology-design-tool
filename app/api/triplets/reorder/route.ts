import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { checkProjectAccess } from "@/lib/project-access"
import type { Triplet } from "@/lib/types"

// トリプレット一覧の並び順の更新。
//
// 並び順は疎な値（lib/organize.ts の ORDER_STEP 刻み）で持つので、ドラッグ1回で
// 届く updates はふつう1件だけ。隙間が尽きて振り直すときだけまとめて届く。
// order は整理の都合であってオントロジーの意味ではないため、
// 確認（confirmations）にも updatedAt / updatedBy にも手を付けない。
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

    const container = await getContainer("triplets")
    const results = await Promise.all(
      updates.map(async ({ id, order }) => {
        const { resource: existing } = await container.item(id, id).read<Triplet>()
        // 他プロジェクトのものは触らない
        if (!existing || existing.projectId !== projectId) return false
        await container.item(id, id).replace({ ...existing, order })
        return true
      }),
    )
    return NextResponse.json({ updated: results.filter(Boolean).length })
  } catch (error) {
    console.error("POST /api/triplets/reorder:", error)
    return NextResponse.json({ error: "トリプレットの並び順の更新に失敗しました" }, { status: 500 })
  }
}
