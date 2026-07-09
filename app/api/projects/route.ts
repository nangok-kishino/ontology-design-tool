import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { getPrincipalName } from "@/lib/auth"
import { isEmailAllowed, validateAllowedDomainsInput } from "@/lib/domain"
import type { Project } from "@/lib/types"

const CONTAINER = "projects"

export async function GET(request: NextRequest) {
  try {
    const container = await getContainer(CONTAINER)
    const { resources } = await container.items.readAll<Project>().fetchAll()
    const email = getPrincipalName(request)
    const visible = resources.filter((p) => isEmailAllowed(p.allowedDomains, email))
    return NextResponse.json(visible)
  } catch (error) {
    console.error("GET /api/projects:", error)
    return NextResponse.json({ error: "プロジェクト一覧の取得に失敗しました" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const actor = getPrincipalName(request)

    const validated = validateAllowedDomainsInput(body.allowedDomains ?? "", actor)
    if ("error" in validated) {
      return NextResponse.json({ error: validated.error }, { status: 400 })
    }

    const now = new Date().toISOString()
    const item: Project = {
      id: crypto.randomUUID(),
      name: body.name,
      description: body.description ?? "",
      allowedDomains: validated.domains,
      createdBy: actor,
      createdAt: now,
      updatedAt: now,
    }
    const container = await getContainer(CONTAINER)
    const { resource } = await container.items.create(item)
    return NextResponse.json(resource, { status: 201 })
  } catch (error) {
    console.error("POST /api/projects:", error)
    return NextResponse.json({ error: "プロジェクトの作成に失敗しました" }, { status: 500 })
  }
}
