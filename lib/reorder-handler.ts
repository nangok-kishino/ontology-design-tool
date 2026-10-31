import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { checkProjectAccess } from "@/lib/project-access"
import { groupsOf } from "@/lib/organize"
import type { OntologyClass, OntologyRelation } from "@/lib/types"

// クラス／リレーションの「整理」更新（所属グループ・並び順）を受ける共通ハンドラ。
//
// 並び順は疎な値（lib/organize.ts の ORDER_STEP 刻み）で持つため、通常の
// ドラッグ1回で届く updates は1件だけになる。隙間が尽きてグループ内を
// 振り直すときだけ複数件まとめて届く。
//
// groupId / order はオントロジーの意味ではなく整理の都合なので、
//   - 確認（confirmations）に edit イベントを積まない（確認済みを無効化しない）
//   - updatedAt / updatedBy も触らない（ドラッグが「更新」として一覧に出ないように）
// という方針にしている。

type Organizable = (OntologyClass | OntologyRelation) & { projectId: string }

type ReorderUpdate = {
  id: string
  order: number
  // 省略時はグループを変更しない。null で未分類に戻す。
  groupId?: string | null
}

export function createReorderHandler(containerId: "classes" | "relations", label: string) {
  return async function POST(request: NextRequest) {
    try {
      const body = await request.json()
      const projectId: string | undefined = body.projectId
      const updates: ReorderUpdate[] = body.updates
      if (!projectId) return NextResponse.json({ error: "projectId が必要です" }, { status: 400 })
      if (!Array.isArray(updates) || updates.length === 0) {
        return NextResponse.json({ error: "updates は空でない配列が必要です" }, { status: 400 })
      }
      if (updates.some((u) => typeof u?.id !== "string" || typeof u?.order !== "number")) {
        return NextResponse.json({ error: "updates の形式が不正です" }, { status: 400 })
      }

      const access = await checkProjectAccess(request, projectId)
      if ("error" in access) return access.error
      // クラス用とリレーション用のグループは別物なので、対応する一覧だけで照合する
      const knownGroups = new Set(
        groupsOf(access.project, containerId === "classes" ? "class" : "relation").map((g) => g.id),
      )

      const container = await getContainer(containerId)
      const results = await Promise.all(
        updates.map(async ({ id, order, groupId }) => {
          const { resource: existing } = await container.item(id, id).read<Organizable>()
          // 他プロジェクトのものは触らない
          if (!existing || existing.projectId !== projectId) return false
          const nextGroupId =
            groupId === undefined
              ? (existing.groupId ?? null)
              : groupId && knownGroups.has(groupId)
                ? groupId
                : null
          await container.item(id, id).replace({ ...existing, groupId: nextGroupId, order })
          return true
        }),
      )
      return NextResponse.json({ updated: results.filter(Boolean).length })
    } catch (error) {
      console.error(`POST /api/${containerId}/reorder:`, error)
      return NextResponse.json({ error: `${label}の並び順の更新に失敗しました` }, { status: 500 })
    }
  }
}
