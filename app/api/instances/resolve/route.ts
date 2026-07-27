import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { getPrincipalName } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/project-access"
import { normalizeName } from "@/lib/normalize"
import { instanceStatus } from "@/lib/instance-status"
import type { NameResolution, NameResolutionMethod, OntologyInstance } from "@/lib/types"

const INSTANCES = "instances"
const RESOLUTIONS = "nameResolutions"

// 名寄せの「単一の出口」。すべての確定操作（人の承認結果）をここに集約する。
//   action=confirm : 仮登録 → 本登録（重複なし／別物として確定）。instanceIds[] を一括処理。
//   action=merge   : loserId を canonicalId に統合。loser は統合済みに、辞書へ登録。
//   action=unmerge : 統合済み instanceId を仮登録へ戻し、辞書エントリを削除（取り消し）。
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const projectId: string | undefined = body.projectId
    if (!projectId) return NextResponse.json({ error: "projectId が必要です" }, { status: 400 })
    const access = await checkProjectAccess(request, projectId)
    if ("error" in access) return access.error

    const actor = getPrincipalName(request)
    const nowIso = new Date().toISOString()
    const today = nowIso.split("T")[0]
    const instances = await getContainer(INSTANCES)
    const resolutions = await getContainer(RESOLUTIONS)

    const readInstance = async (id: string): Promise<OntologyInstance | null> => {
      const { resource } = await instances.item(id, id).read<OntologyInstance>()
      return resource ?? null
    }

    // --- confirm: 仮登録 → 本登録 ---
    if (body.action === "confirm") {
      const ids: string[] = Array.isArray(body.instanceIds) ? body.instanceIds : []
      let confirmed = 0
      for (const id of ids) {
        const inst = await readInstance(id)
        if (!inst || inst.projectId !== projectId) continue
        if (instanceStatus(inst) === "merged") continue // 統合済みは対象外
        await instances.item(id, id).replace({
          ...inst,
          status: "confirmed",
          updatedBy: actor,
          updatedAt: today,
        })
        confirmed++
      }
      return NextResponse.json({ confirmed })
    }

    // --- merge: loser を canonical に統合 ---
    if (body.action === "merge") {
      const loserId: string = body.loserId
      const canonicalId: string = body.canonicalId
      const method: NameResolutionMethod = body.method ?? "normalize"
      if (!loserId || !canonicalId || loserId === canonicalId) {
        return NextResponse.json({ error: "loserId と canonicalId（別々）が必要です" }, { status: 400 })
      }
      const loser = await readInstance(loserId)
      const canonical = await readInstance(canonicalId)
      if (!loser || !canonical) return NextResponse.json({ error: "対象が見つかりません" }, { status: 404 })
      if (loser.projectId !== projectId || canonical.projectId !== projectId) {
        return NextResponse.json({ error: "プロジェクトが一致しません" }, { status: 400 })
      }

      // 代表の別名に loser の name とその別名を追加（重複除去）
      const aliasSet = new Set<string>(canonical.aliases ?? [])
      aliasSet.add(loser.name)
      for (const a of loser.aliases ?? []) aliasSet.add(a)

      // 属性値: UIが提示した差分で人が選んだ結果を受け取る（未指定なら代表の現状維持）
      const canonicalAttributes =
        body.canonicalAttributes !== undefined ? body.canonicalAttributes : canonical.attributes

      // 統合は代表の本登録も確定させる
      await instances.item(canonicalId, canonicalId).replace({
        ...canonical,
        status: "confirmed",
        aliases: Array.from(aliasSet),
        attributes: canonicalAttributes,
        updatedBy: actor,
        updatedAt: today,
      })

      // loser を統合済みに
      await instances.item(loserId, loserId).replace({
        ...loser,
        status: "merged",
        mergedInto: canonicalId,
        updatedBy: actor,
        updatedAt: today,
      })

      // 名寄せ辞書へ登録（loser の元表記＋その別名）
      const aliasesToRecord = [loser.name, ...(loser.aliases ?? [])]
      for (const alias of aliasesToRecord) {
        const record: NameResolution = {
          id: crypto.randomUUID(),
          projectId,
          classId: canonical.classId ?? null,
          alias,
          normalizedAlias: normalizeName(alias),
          canonicalInstanceId: canonicalId,
          method,
          approvedBy: actor,
          approvedAt: nowIso,
        }
        await resolutions.items.create(record)
      }

      // loser を代表としていた既存辞書エントリを canonical に付け替え
      const { resources: pointingToLoser } = await resolutions.items
        .query<NameResolution>({
          query: "SELECT * FROM c WHERE c.projectId = @p AND c.canonicalInstanceId = @loser",
          parameters: [
            { name: "@p", value: projectId },
            { name: "@loser", value: loserId },
          ],
        })
        .fetchAll()
      for (const r of pointingToLoser) {
        await resolutions.item(r.id, r.id).replace({ ...r, canonicalInstanceId: canonicalId })
      }

      return NextResponse.json({ merged: loserId, canonical: canonicalId })
    }

    // --- unmerge: 統合の取り消し ---
    if (body.action === "unmerge") {
      const instanceId: string = body.instanceId
      const inst = await readInstance(instanceId)
      if (!inst) return NextResponse.json({ error: "対象が見つかりません" }, { status: 404 })
      if (inst.projectId !== projectId) {
        return NextResponse.json({ error: "プロジェクトが一致しません" }, { status: 400 })
      }
      if (instanceStatus(inst) !== "merged") {
        return NextResponse.json({ error: "統合済みのインスタンスではありません" }, { status: 400 })
      }
      const canonicalId = inst.mergedInto ?? null

      // 仮登録へ戻す
      await instances.item(instanceId, instanceId).replace({
        ...inst,
        status: "provisional",
        mergedInto: null,
        updatedBy: actor,
        updatedAt: today,
      })

      if (canonicalId) {
        const canonical = await readInstance(canonicalId)
        if (canonical) {
          // 代表の別名から取り消し対象の表記を除去
          const removeSet = new Set<string>([inst.name, ...(inst.aliases ?? [])])
          const remaining = (canonical.aliases ?? []).filter((a) => !removeSet.has(a))
          await instances.item(canonicalId, canonicalId).replace({
            ...canonical,
            aliases: remaining,
            updatedBy: actor,
            updatedAt: today,
          })
        }
        // 対応する辞書エントリを削除
        const { resources: toDelete } = await resolutions.items
          .query<NameResolution>({
            query:
              "SELECT * FROM c WHERE c.projectId = @p AND c.canonicalInstanceId = @canon AND c.alias = @alias",
            parameters: [
              { name: "@p", value: projectId },
              { name: "@canon", value: canonicalId },
              { name: "@alias", value: inst.name },
            ],
          })
          .fetchAll()
        for (const r of toDelete) {
          await resolutions.item(r.id, r.id).delete()
        }
      }

      return NextResponse.json({ unmerged: instanceId })
    }

    return NextResponse.json({ error: "不明な action です" }, { status: 400 })
  } catch (error) {
    console.error("POST /api/instances/resolve:", error)
    return NextResponse.json({ error: "名寄せの確定に失敗しました" }, { status: 500 })
  }
}
