import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { checkProjectAccess } from "@/lib/project-access"
import { nextOrder, sortGroups } from "@/lib/organize"
import type { OntologyGroup, Project } from "@/lib/types"

// 整理用グループの CRUD。定義は Project ドキュメントの groups に埋め込んで持つ。
//   プロジェクトはアクセス確認で必ず読むため、専用コンテナを増やさずに済む。
//   一覧全体を置き換える PUT が、名称変更・色変更・並び替え・削除をまとめて受ける。
//   同時編集は後勝ちになる（グループは人が時々整理するだけの軽い操作のため許容する）。

const CONTAINER = "projects"

async function saveGroups(project: Project, groups: OntologyGroup[]) {
  const container = await getContainer(CONTAINER)
  const updated: Project = { ...project, groups, updatedAt: new Date().toISOString() }
  await container.item(project.id, project.id).replace(updated)
}

// 無くなったグループを指したままのクラス／リレーションから groupId を外す。
// （外し忘れても表示側は未知の groupId を「未分類」として扱うため、あくまで後始末）
async function clearRemovedRefs(projectId: string, removedIds: string[]) {
  if (removedIds.length === 0) return
  await Promise.all(
    (["classes", "relations"] as const).map(async (containerId) => {
      const container = await getContainer(containerId)
      const { resources } = await container.items
        .query<{ id: string }>({
          query: `SELECT c.id FROM c WHERE c.projectId = @projectId AND ARRAY_CONTAINS(@removed, c.groupId)`,
          parameters: [
            { name: "@projectId", value: projectId },
            { name: "@removed", value: removedIds },
          ],
        })
        .fetchAll()
      await Promise.all(
        resources.map(async ({ id }) => {
          const { resource: existing } = await container.item(id, id).read()
          if (!existing) return
          await container.item(id, id).replace({ ...existing, groupId: null })
        }),
      )
    }),
  )
}

export async function GET(request: NextRequest) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId")
    if (!projectId) return NextResponse.json({ error: "projectId が必要です" }, { status: 400 })
    const access = await checkProjectAccess(request, projectId)
    if ("error" in access) return access.error
    return NextResponse.json(sortGroups(access.project.groups ?? []))
  } catch (error) {
    console.error("GET /api/groups:", error)
    return NextResponse.json({ error: "グループの取得に失敗しました" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const projectId: string | undefined = body.projectId
    const name = typeof body.name === "string" ? body.name.trim() : ""
    if (!projectId) return NextResponse.json({ error: "projectId が必要です" }, { status: 400 })
    if (!name) return NextResponse.json({ error: "グループ名を入力してください" }, { status: 400 })
    const access = await checkProjectAccess(request, projectId)
    if ("error" in access) return access.error

    const groups = access.project.groups ?? []
    if (groups.some((g) => g.name === name)) {
      return NextResponse.json({ error: `グループ「${name}」は既に存在します` }, { status: 409 })
    }
    const group: OntologyGroup = {
      id: crypto.randomUUID(),
      name,
      color: typeof body.color === "string" && body.color ? body.color : undefined,
      order: nextOrder(groups),
    }
    await saveGroups(access.project, [...groups, group])
    return NextResponse.json(group, { status: 201 })
  } catch (error) {
    console.error("POST /api/groups:", error)
    return NextResponse.json({ error: "グループの作成に失敗しました" }, { status: 500 })
  }
}

// 一覧まるごと置き換え（名称変更・色変更・並び替え・削除）
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const projectId: string | undefined = body.projectId
    if (!projectId) return NextResponse.json({ error: "projectId が必要です" }, { status: 400 })
    if (!Array.isArray(body.groups)) {
      return NextResponse.json({ error: "groups は配列が必要です" }, { status: 400 })
    }
    const access = await checkProjectAccess(request, projectId)
    if ("error" in access) return access.error

    const seenNames = new Set<string>()
    const groups: OntologyGroup[] = []
    for (const [index, raw] of (body.groups as unknown[]).entries()) {
      const item = raw as Partial<OntologyGroup>
      const id = typeof item?.id === "string" ? item.id : ""
      const name = typeof item?.name === "string" ? item.name.trim() : ""
      if (!id || !name) {
        return NextResponse.json({ error: "グループ名を入力してください" }, { status: 400 })
      }
      if (seenNames.has(name)) {
        return NextResponse.json({ error: `グループ名「${name}」が重複しています` }, { status: 409 })
      }
      seenNames.add(name)
      groups.push({
        id,
        name,
        color: typeof item.color === "string" && item.color ? item.color : undefined,
        order: typeof item.order === "number" ? item.order : index,
      })
    }

    const keptIds = new Set(groups.map((g) => g.id))
    const removedIds = (access.project.groups ?? []).map((g) => g.id).filter((id) => !keptIds.has(id))
    await saveGroups(access.project, groups)
    await clearRemovedRefs(projectId, removedIds)
    return NextResponse.json(sortGroups(groups))
  } catch (error) {
    console.error("PUT /api/groups:", error)
    return NextResponse.json({ error: "グループの更新に失敗しました" }, { status: 500 })
  }
}
