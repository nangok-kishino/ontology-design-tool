import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { getPrincipalName } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/project-access"
import { normalizeName } from "@/lib/normalize"
import { instanceStatus } from "@/lib/instance-status"
import type { InstanceStatus, OntologyInstance } from "@/lib/types"

const CONTAINER = "instances"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const container = await getContainer(CONTAINER)
    const { resource } = await container.item(id, id).read<OntologyInstance>()
    if (!resource) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const access = await checkProjectAccess(request, resource.projectId)
    if ("error" in access) return access.error
    return NextResponse.json(resource)
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("GET /api/instances/[id]:", error)
    return NextResponse.json({ error: "インスタンスの取得に失敗しました" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const container = await getContainer(CONTAINER)
    const { resource: existing } = await container.item(id, id).read<OntologyInstance>()
    if (!existing) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const access = await checkProjectAccess(request, existing.projectId)
    if ("error" in access) return access.error
    const now = new Date().toISOString().split("T")[0]

    const newName = body.name ?? existing.name
    const newNormalized = normalizeName(newName)
    const prevNormalized = existing.normalizedName ?? normalizeName(existing.name)

    // status の決定:
    //   1) 統合/取消などで明示指定があればそれに従う
    //   2) 本登録済み（既存 confirmed）の名前が実質変更されたら仮登録へ差し戻す（判断点3）
    //   3) それ以外は現状維持
    let status: InstanceStatus = instanceStatus(existing)
    if (body.status === "provisional" || body.status === "confirmed" || body.status === "merged") {
      status = body.status
    } else if (newNormalized !== prevNormalized && status === "confirmed") {
      status = "provisional"
    }

    const updated: OntologyInstance = {
      ...existing,
      name: newName,
      normalizedName: newNormalized,
      classId: "classId" in body ? (body.classId ?? null) : existing.classId,
      attributes: body.attributes !== undefined ? body.attributes : existing.attributes,
      status,
      mergedInto: "mergedInto" in body ? (body.mergedInto ?? null) : existing.mergedInto,
      aliases: body.aliases !== undefined ? body.aliases : existing.aliases,
      updatedBy: getPrincipalName(request),
      updatedAt: now,
    }
    const { resource } = await container.item(id, id).replace(updated)
    return NextResponse.json(resource)
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("PUT /api/instances/[id]:", error)
    return NextResponse.json({ error: "インスタンスの更新に失敗しました" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const container = await getContainer(CONTAINER)
    const { resource: existing } = await container.item(id, id).read<OntologyInstance>()
    if (!existing) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    const access = await checkProjectAccess(request, existing.projectId)
    if ("error" in access) return access.error
    await container.item(id, id).delete()
    return new NextResponse(null, { status: 204 })
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("DELETE /api/instances/[id]:", error)
    return NextResponse.json({ error: "インスタンスの削除に失敗しました" }, { status: 500 })
  }
}
