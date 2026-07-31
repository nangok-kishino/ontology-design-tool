import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { getPrincipalName } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/project-access"
import { normalizeName } from "@/lib/normalize"
import { normalizedNameOf, isMerged } from "@/lib/instance-status"
import type { InstanceStatus, OntologyInstance } from "@/lib/types"

const CONTAINER = "instances"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const classId = searchParams.get("classId")
    const projectId = searchParams.get("projectId")
    const mergedInto = searchParams.get("mergedInto")
    // 統合済み(merged)は既定で除外（通常の一覧・件数に出さない）。
    // includeMerged=1 のときのみ含める（統合履歴の表示用）。
    const includeMerged = searchParams.get("includeMerged") === "1"
    const container = await getContainer(CONTAINER)

    if (projectId) {
      const access = await checkProjectAccess(request, projectId)
      if ("error" in access) return access.error
    }

    // 指定した代表インスタンスに統合された（統合済みの）インスタンス一覧
    if (mergedInto) {
      const { resources } = await container.items
        .query<OntologyInstance>({
          query: "SELECT * FROM c WHERE c.mergedInto = @mid",
          parameters: [{ name: "@mid", value: mergedInto }],
        })
        .fetchAll()
      return NextResponse.json(resources)
    }

    // status が 'merged' の項目を除外する条件（status 未設定の既存データは残す）
    const notMerged = "(NOT IS_DEFINED(c.status) OR c.status != 'merged')"

    if (classId === "unclassified") {
      const base = "(IS_NULL(c.classId) OR NOT IS_DEFINED(c.classId))"
      const query = includeMerged
        ? `SELECT * FROM c WHERE ${base}`
        : `SELECT * FROM c WHERE ${base} AND ${notMerged}`
      const { resources } = await container.items.query<OntologyInstance>({ query }).fetchAll()
      return NextResponse.json(resources)
    }

    if (classId) {
      const query = includeMerged
        ? "SELECT * FROM c WHERE c.classId = @classId"
        : `SELECT * FROM c WHERE c.classId = @classId AND ${notMerged}`
      const { resources } = await container.items
        .query<OntologyInstance>({
          query,
          parameters: [{ name: "@classId", value: classId }],
        })
        .fetchAll()
      return NextResponse.json(resources)
    }

    if (projectId) {
      const query = includeMerged
        ? "SELECT * FROM c WHERE c.projectId = @projectId"
        : `SELECT * FROM c WHERE c.projectId = @projectId AND ${notMerged}`
      const { resources } = await container.items
        .query<OntologyInstance>({
          query,
          parameters: [{ name: "@projectId", value: projectId }],
        })
        .fetchAll()
      return NextResponse.json(resources)
    }

    const { resources } = await container.items.readAll<OntologyInstance>().fetchAll()
    return NextResponse.json(resources)
  } catch (error) {
    console.error("GET /api/instances:", error)
    return NextResponse.json({ error: "インスタンス一覧の取得に失敗しました" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    if (body.projectId) {
      const access = await checkProjectAccess(request, body.projectId)
      if ("error" in access) return access.error
    }
    const now = new Date().toISOString().split("T")[0]
    const actor = getPrincipalName(request)

    const container = await getContainer(CONTAINER)

    // 重複弾き（正規化一致・全経路）: 同一クラス内に normalizeName が一致する
    // 既存インスタンス（統合済みは除く）があれば登録を拒否する。あいまい統合は
    // 名寄せチェックで扱う想定のため、ここは「同一クラス×正規化一致」のみブロックする。
    // POST は全登録経路（手動追加/YAMLインポート/LLM候補採用）の単一チョークポイント。
    const targetClassId: string | null = body.classId ?? null
    const targetNormalized = normalizeName(body.name)
    if (body.projectId && targetNormalized) {
      const classMatch =
        targetClassId === null
          ? "(IS_NULL(c.classId) OR NOT IS_DEFINED(c.classId))"
          : "c.classId = @classId"
      const dupQuery: { query: string; parameters: { name: string; value: string }[] } = {
        query: `SELECT * FROM c WHERE c.projectId = @projectId AND ${classMatch}`,
        parameters: [{ name: "@projectId", value: body.projectId }],
      }
      if (targetClassId !== null) dupQuery.parameters.push({ name: "@classId", value: targetClassId })
      const { resources: sameClass } = await container.items
        .query<OntologyInstance>(dupQuery)
        .fetchAll()
      const duplicate = sameClass.some(
        (inst) => !isMerged(inst) && normalizedNameOf(inst) === targetNormalized,
      )
      if (duplicate) {
        return NextResponse.json(
          { error: "同一クラスに同名（表記揺れ含む）のインスタンスが既に存在します", duplicate: true },
          { status: 409 },
        )
      }
    }

    // 全登録経路は「本登録済み・名寄せ未チェック(provisional)」で着地させる。
    // 名寄せチェックを通過すると confirmed（＝チェック済み）になる。
    // 移行・復元など特別な経路のみ body.status での明示指定を許容する。
    const status: InstanceStatus =
      body.status === "confirmed" || body.status === "merged" ? body.status : "provisional"
    const item: OntologyInstance = {
      id: crypto.randomUUID(),
      projectId: body.projectId,
      name: body.name,
      classId: body.classId ?? null,
      registeredBy: actor,
      registeredAt: now,
      updatedBy: actor,
      updatedAt: now,
      attributes: body.attributes ?? {},
      status,
      normalizedName: targetNormalized,
    }
    const { resource } = await container.items.create(item)
    return NextResponse.json(resource, { status: 201 })
  } catch (error) {
    console.error("POST /api/instances:", error)
    return NextResponse.json({ error: "インスタンスの作成に失敗しました" }, { status: 500 })
  }
}
