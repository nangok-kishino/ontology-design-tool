import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { checkProjectAccess } from "@/lib/project-access"
import type { OntologyInstance } from "@/lib/types"

export async function POST(request: NextRequest) {
  try {
    const { updates }: { updates: Array<{ id: string; order: number }> } = await request.json()
    if (!Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json({ error: "updates は空でない配列が必要です" }, { status: 400 })
    }
    const container = await getContainer("instances")

    const { resource: first } = await container.item(updates[0].id, updates[0].id).read<OntologyInstance>()
    if (first) {
      const access = await checkProjectAccess(request, first.projectId)
      if ("error" in access) return access.error
    }

    await Promise.all(
      updates.map(async ({ id, order }) => {
        const { resource: existing } = await container.item(id, id).read<OntologyInstance>()
        if (!existing) return
        await container.item(id, id).replace({ ...existing, order })
      }),
    )
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("POST /api/instances/reorder:", error)
    return NextResponse.json({ error: "並び順の更新に失敗しました" }, { status: 500 })
  }
}
