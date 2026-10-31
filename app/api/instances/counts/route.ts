import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { checkProjectAccess } from "@/lib/project-access"
import { instanceStatus } from "@/lib/instance-status"
import type { InstanceStatus } from "@/lib/types"

const CONTAINER = "instances"

// status が 'merged' の項目を除外する条件（status 未設定の既存データは残す）
const NOT_MERGED = "(NOT IS_DEFINED(c.status) OR c.status != 'merged')"

type CountRow = { classId: string | null; status?: InstanceStatus }

// クラス別のインスタンス件数をまとめて返す。
// 一覧画面の件数バッジ・ボタン活性の更新用で、従来はクラス1件ごとに
// GET /api/instances?classId=... を投げていた（クラス数＋2本の全件取得）。
// ここでは必要な列だけを 2 本のクエリで取得する。
//   byClass    : classId ごとの件数（未知のクラスIDも含む。呼び出し側で孤児判定に使う）
//   nullClass  : classId が未設定のインスタンス件数
//   provisional: 名寄せ未チェック（仮）件数（プロジェクト全体）
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get("projectId")
    if (!projectId) {
      return NextResponse.json({ error: "projectId が必要です" }, { status: 400 })
    }
    const access = await checkProjectAccess(request, projectId)
    if ("error" in access) return access.error

    const container = await getContainer(CONTAINER)
    const [{ resources: rows }, { resources: nullCounts }] = await Promise.all([
      container.items
        .query<CountRow>({
          query: `SELECT c.classId, c.status FROM c WHERE c.projectId = @projectId AND ${NOT_MERGED}`,
          parameters: [{ name: "@projectId", value: projectId }],
        })
        .fetchAll(),
      // 未分類（classId 未設定）は従来の GET /api/instances?classId=unclassified と
      // 同じくプロジェクトで絞らずに数える（件数の意味を変えないため）
      container.items
        .query<number>({
          query: `SELECT VALUE COUNT(1) FROM c WHERE (IS_NULL(c.classId) OR NOT IS_DEFINED(c.classId)) AND ${NOT_MERGED}`,
        })
        .fetchAll(),
    ])

    const byClass: Record<string, number> = {}
    let provisional = 0
    for (const row of rows) {
      if (row.classId) byClass[row.classId] = (byClass[row.classId] ?? 0) + 1
      if (instanceStatus(row) === "provisional") provisional += 1
    }

    return NextResponse.json({
      byClass,
      nullClass: nullCounts[0] ?? 0,
      provisional,
    })
  } catch (error) {
    console.error("GET /api/instances/counts:", error)
    return NextResponse.json({ error: "インスタンス件数の取得に失敗しました" }, { status: 500 })
  }
}
