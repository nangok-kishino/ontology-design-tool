import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { getPrincipalName } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/project-access"
import { appendConfirmEvent, appendUnconfirmEvent } from "@/lib/confirmation"
import { CONTAINERS, type GraphNode } from "@/lib/graph-types"

const CONTAINER = CONTAINERS.nodes

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const confirmerName = typeof body.confirmerName === "string" ? body.confirmerName.trim() : ""
    if (!confirmerName) {
      return NextResponse.json({ error: "確認者名を入力してください" }, { status: 400 })
    }
    const container = await getContainer(CONTAINER)
    const { resource: existing } = await container.item(id, id).read<GraphNode>()
    if (!existing) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const access = await checkProjectAccess(request, existing.projectId)
    if ("error" in access) return access.error
    const updated: GraphNode = {
      ...existing,
      confirmations: appendConfirmEvent(existing.confirmations, getPrincipalName(request), confirmerName),
    }
    const { resource } = await container.item(id, id).replace(updated)
    return NextResponse.json(resource)
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("POST /api/nodes/[id]/confirmations:", error)
    return NextResponse.json({ error: "確認の追加に失敗しました" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const container = await getContainer(CONTAINER)
    const { resource: existing } = await container.item(id, id).read<GraphNode>()
    if (!existing) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const access = await checkProjectAccess(request, existing.projectId)
    if ("error" in access) return access.error
    const updated: GraphNode = {
      ...existing,
      confirmations: appendUnconfirmEvent(existing.confirmations, getPrincipalName(request)),
    }
    const { resource } = await container.item(id, id).replace(updated)
    return NextResponse.json(resource)
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("DELETE /api/nodes/[id]/confirmations:", error)
    return NextResponse.json({ error: "確認の取消に失敗しました" }, { status: 500 })
  }
}
