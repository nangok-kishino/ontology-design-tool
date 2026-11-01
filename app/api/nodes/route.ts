import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { getPrincipalName } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/project-access"
import { normalizeName, trimName } from "@/lib/normalize"
import { CONTAINERS, type GraphNode } from "@/lib/graph-types"

const CONTAINER = CONTAINERS.nodes

// ラベル集合が同じか（順序は問わない）。名寄せの照合スコープに使う。
function sameLabelSet(a: string[] | undefined, b: string[] | undefined): boolean {
  const x = [...(a ?? [])].sort()
  const y = [...(b ?? [])].sort()
  return x.length === y.length && x.every((v, i) => v === y[i])
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get("projectId")
    const labelId = searchParams.get("labelId")
    const includeMerged = searchParams.get("includeMerged") === "1"
    const mergedInto = searchParams.get("mergedInto")
    if (!projectId) return NextResponse.json({ error: "projectId が必要です" }, { status: 400 })
    const access = await checkProjectAccess(request, projectId)
    if ("error" in access) return access.error

    const container = await getContainer(CONTAINER)
    const { resources } = await container.items
      .query<GraphNode>({
        query: "SELECT * FROM c WHERE c.projectId = @p",
        parameters: [{ name: "@p", value: projectId }],
      })
      .fetchAll()

    let rows = resources
    // 統合先（代表）を指定された場合は、その配下の統合済みノードだけを返す
    if (mergedInto) return NextResponse.json(rows.filter((n) => n.mergedInto === mergedInto))
    if (!includeMerged) rows = rows.filter((n) => n.status !== "merged")
    if (labelId === "__none__") rows = rows.filter((n) => (n.labelIds ?? []).length === 0)
    else if (labelId) rows = rows.filter((n) => (n.labelIds ?? []).includes(labelId))

    return NextResponse.json(rows)
  } catch (error) {
    console.error("GET /api/nodes:", error)
    return NextResponse.json({ error: "ノード一覧の取得に失敗しました" }, { status: 500 })
  }
}

// すべての登録経路がここを通る。同じラベル集合に、正規化して同じ名前のノードがあれば 409。
// ラベルが違えば別物として通す（名寄せの照合スコープ＝「ラベル集合が完全一致 × 正規化名」）。
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    if (!body.projectId) return NextResponse.json({ error: "projectId が必要です" }, { status: 400 })
    const access = await checkProjectAccess(request, body.projectId)
    if ("error" in access) return access.error

    const name = trimName(body.name ?? "")
    if (!name) return NextResponse.json({ error: "ノード名を入力してください" }, { status: 400 })
    const labelIds: string[] = Array.isArray(body.labelIds)
      ? [...new Set(body.labelIds.filter((v: unknown) => typeof v === "string"))] as string[]
      : []
    const normalized = normalizeName(name)

    const container = await getContainer(CONTAINER)
    const { resources: existing } = await container.items
      .query<GraphNode>({
        query: "SELECT * FROM c WHERE c.projectId = @p AND c.normalizedName = @n",
        parameters: [{ name: "@p", value: body.projectId }, { name: "@n", value: normalized }],
      })
      .fetchAll()
    const duplicate = existing.find((n) => n.status !== "merged" && sameLabelSet(n.labelIds, labelIds))
    if (duplicate) {
      return NextResponse.json(
        { error: `同じラベルの「${duplicate.name}」が既に登録されています`, existing: duplicate },
        { status: 409 },
      )
    }

    const now = new Date().toISOString()
    const actor = getPrincipalName(request)
    const item: GraphNode = {
      id: crypto.randomUUID(),
      projectId: body.projectId,
      name,
      labelIds,
      properties: body.properties ?? undefined,
      order: body.order,
      // 登録は即時。名寄せチェックは別軸なので、着地点は未チェック。
      status: "provisional",
      normalizedName: normalized,
      registeredBy: actor,
      registeredAt: now,
      updatedBy: actor,
      updatedAt: now,
    }
    const { resource } = await container.items.create(item)
    return NextResponse.json(resource, { status: 201 })
  } catch (error) {
    console.error("POST /api/nodes:", error)
    return NextResponse.json({ error: "ノードの作成に失敗しました" }, { status: 500 })
  }
}
