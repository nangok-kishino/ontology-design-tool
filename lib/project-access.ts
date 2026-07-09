import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { getPrincipalName } from "@/lib/auth"
import { isEmailAllowed } from "@/lib/domain"
import type { Project } from "@/lib/types"

type AccessResult = { project: Project } | { error: NextResponse }

// 指定プロジェクトに対して、現在ログイン中のユーザー（Cookieのメールアドレス）がアクセス可能か検証する
export async function checkProjectAccess(request: NextRequest, projectId: string): Promise<AccessResult> {
  const container = await getContainer("projects")
  const { resource: project } = await container.item(projectId, projectId).read<Project>()
  if (!project) {
    return { error: NextResponse.json({ error: "プロジェクトが見つかりません" }, { status: 404 }) }
  }
  const email = getPrincipalName(request)
  if (!isEmailAllowed(project.allowedDomains, email)) {
    return { error: NextResponse.json({ error: "このプロジェクトへのアクセス権限がありません" }, { status: 403 }) }
  }
  return { project }
}
