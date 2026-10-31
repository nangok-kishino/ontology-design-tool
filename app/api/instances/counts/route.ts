import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { checkProjectAccess } from "@/lib/project-access"

const CONTAINER = "instances"

// status が 'merged' の項目を除外する条件（status 未設定の既存データは残す）
const NOT_MERGED = "(NOT IS_DEFINED(c.status) OR c.status != 'merged')"

type GroupRow = { classId?: string | null; n: number }

// クラス別のインスタンス件数をまとめて返す。
// 一覧画面の件数バッジ・ボタン活性の更新用で、従来はクラス1件ごとに
// GET /api/instances?classId=... を投げていた（クラス数＋2本の全件取得）。
// ここでは集計をすべてサーバ側（Cosmos）で済ませ、返すのはクラス数ぶんの行だけにする
//（1インスタンス1行で受け取ると、件数が増えるほど転送と集計が重くなる）。
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
    const projectParam = [{ name: "@projectId", value: projectId }]
    const [{ resources: rows }, { resources: nullCounts }, { resources: provisionalCounts }] =
      await Promise.all([
        container.items
          .query<GroupRow>({
            query: `SELECT c.classId, COUNT(1) AS n FROM c WHERE c.projectId = @projectId AND ${NOT_MERGED} GROUP BY c.classId`,
            parameters: projectParam,
          })
          .fetchAll(),
        // 未分類（classId 未設定）は従来の GET /api/instances?classId=unclassified と
        // 同じくプロジェクトで絞らずに数える（件数の意味を変えないため）
        container.items
          .query<number>({
            query: `SELECT VALUE COUNT(1) FROM c WHERE (IS_NULL(c.classId) OR NOT IS_DEFINED(c.classId)) AND ${NOT_MERGED}`,
          })
          .fetchAll(),
        // status 未設定の既存データは confirmed 扱い（lib/instance-status.ts）なので、
        // 名寄せ未チェックは status === 'provisional' だけを数えればよい
        container.items
          .query<number>({
            query: "SELECT VALUE COUNT(1) FROM c WHERE c.projectId = @projectId AND c.status = 'provisional'",
            parameters: projectParam,
          })
          .fetchAll(),
      ])

    const byClass: Record<string, number> = {}
    for (const row of rows) {
      if (typeof row.classId === "string" && row.classId) byClass[row.classId] = row.n
    }

    return NextResponse.json({
      byClass,
      nullClass: nullCounts[0] ?? 0,
      provisional: provisionalCounts[0] ?? 0,
    })
  } catch (error) {
    console.error("GET /api/instances/counts:", error)
    return NextResponse.json({ error: "インスタンス件数の取得に失敗しました" }, { status: 500 })
  }
}
