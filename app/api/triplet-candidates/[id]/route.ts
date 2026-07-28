import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { checkProjectAccess } from "@/lib/project-access"
import type { TripletCandidate } from "@/lib/types"

const CANDIDATES = "tripletCandidates"

// 却下、または承認（本登録）後のクリーンアップで候補を削除する。
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const container = await getContainer(CANDIDATES)
    const { resource: existing } = await container.item(id, id).read<TripletCandidate>()
    if (!existing) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const access = await checkProjectAccess(request, existing.projectId)
    if ("error" in access) return access.error
    await container.item(id, id).delete()
    return new NextResponse(null, { status: 204 })
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("DELETE /api/triplet-candidates/[id]:", error)
    return NextResponse.json({ error: "トリプレット候補の削除に失敗しました" }, { status: 500 })
  }
}
