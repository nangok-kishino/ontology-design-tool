import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { getPrincipalName } from "@/lib/auth"
import { validateAllowedDomainsInput } from "@/lib/domain"
import { checkProjectAccess } from "@/lib/project-access"
import type { Project } from "@/lib/types"

const CONTAINER = "projects"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const access = await checkProjectAccess(request, id)
    if ("error" in access) return access.error
    return NextResponse.json(access.project)
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("GET /api/projects/[id]:", error)
    return NextResponse.json({ error: "プロジェクトの取得に失敗しました" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const access = await checkProjectAccess(request, id)
    if ("error" in access) return access.error
    const existing = access.project

    const body = await request.json()
    const actor = getPrincipalName(request)

    let allowedDomains = existing.allowedDomains ?? []
    if (typeof body.allowedDomains === "string") {
      const validated = validateAllowedDomainsInput(body.allowedDomains, actor)
      if ("error" in validated) {
        return NextResponse.json({ error: validated.error }, { status: 400 })
      }
      allowedDomains = validated.domains
    }

    const container = await getContainer(CONTAINER)
    const updated: Project = {
      ...existing,
      name: body.name ?? existing.name,
      description: body.description ?? existing.description,
      allowedDomains,
      updatedAt: new Date().toISOString(),
    }
    const { resource } = await container.item(id, id).replace(updated)
    return NextResponse.json(resource)
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("PUT /api/projects/[id]:", error)
    return NextResponse.json({ error: "プロジェクトの更新に失敗しました" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const access = await checkProjectAccess(request, id)
    if ("error" in access) return access.error

    const container = await getContainer(CONTAINER)
    await container.item(id, id).delete()
    return new NextResponse(null, { status: 204 })
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("DELETE /api/projects/[id]:", error)
    return NextResponse.json({ error: "プロジェクトの削除に失敗しました" }, { status: 500 })
  }
}
