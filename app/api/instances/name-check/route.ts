import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { checkProjectAccess } from "@/lib/project-access"
import { instanceStatus, normalizedNameOf, isMerged } from "@/lib/instance-status"
import type { NameResolution, OntologyInstance } from "@/lib/types"

const INSTANCES = "instances"
const RESOLUTIONS = "nameResolutions"

// 名寄せチェック（フェーズ1: 正規化ブロッキングによる候補検出）。
// システムは候補を提示するだけで、統合・本登録の確定は行わない（原則A）。
//   - 判定対象: 仮登録(provisional)インスタンス
//   - 基準集合: 本登録(confirmed) ＋ 仮登録同士 ＋ 名寄せ辞書
// normalizedName が一致するものを同一バケットにまとめる。統合済み(merged)は対象外。
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get("projectId")
    if (!projectId) {
      return NextResponse.json({ error: "projectId が必要です" }, { status: 400 })
    }
    const access = await checkProjectAccess(request, projectId)
    if ("error" in access) return access.error

    const instancesContainer = await getContainer(INSTANCES)
    const { resources: all } = await instancesContainer.items
      .query<OntologyInstance>({
        query: "SELECT * FROM c WHERE c.projectId = @projectId",
        parameters: [{ name: "@projectId", value: projectId }],
      })
      .fetchAll()

    // 統合済みは判定・基準の双方から除外
    const active = all.filter((inst) => !isMerged(inst))

    // normalizedName でバケット化
    const buckets = new Map<string, OntologyInstance[]>()
    for (const inst of active) {
      const key = normalizedNameOf(inst)
      if (!key) continue // 空名は対象外
      const arr = buckets.get(key)
      if (arr) arr.push(inst)
      else buckets.set(key, [inst])
    }

    const provisionals = active.filter((inst) => instanceStatus(inst) === "provisional")
    const provisionalCount = provisionals.length

    // 重複グループ: バケットサイズ>=2 かつ 仮登録を1件以上含む
    const groups: { key: string; members: OntologyInstance[] }[] = []
    const groupedProvisionalIds = new Set<string>()
    for (const [key, members] of buckets) {
      if (members.length < 2) continue
      if (!members.some((m) => instanceStatus(m) === "provisional")) continue
      groups.push({ key, members })
      for (const m of members) {
        if (instanceStatus(m) === "provisional") groupedProvisionalIds.add(m.id)
      }
    }

    // 名寄せ辞書の参照（既知の対応）
    const resolutionsContainer = await getContainer(RESOLUTIONS)
    const { resources: resolutions } = await resolutionsContainer.items
      .query<NameResolution>({
        query: "SELECT * FROM c WHERE c.projectId = @projectId",
        parameters: [{ name: "@projectId", value: projectId }],
      })
      .fetchAll()
    const canonicalIds = new Set(active.map((i) => i.id))
    const resolutionByNorm = new Map<string, NameResolution>()
    for (const r of resolutions) {
      // 代表インスタンスが現存するものだけを有効な辞書エントリとする
      if (canonicalIds.has(r.canonicalInstanceId)) resolutionByNorm.set(r.normalizedAlias, r)
    }

    // 辞書一致（重複グループに含まれない仮登録のうち、辞書に既知の対応があるもの）
    const activeById = new Map(active.map((i) => [i.id, i]))
    const dictionarySuggestions: {
      instance: OntologyInstance
      canonical: OntologyInstance
      resolutionId: string
    }[] = []
    for (const inst of provisionals) {
      if (groupedProvisionalIds.has(inst.id)) continue
      const hit = resolutionByNorm.get(normalizedNameOf(inst))
      if (hit && hit.canonicalInstanceId !== inst.id) {
        const canonical = activeById.get(hit.canonicalInstanceId)
        if (canonical) {
          dictionarySuggestions.push({ instance: inst, canonical, resolutionId: hit.id })
        }
      }
    }
    const dictSuggestedIds = new Set(dictionarySuggestions.map((d) => d.instance.id))

    // 単独（重複なし・辞書一致なしの仮登録）→ そのまま本登録できる
    const singletons = provisionals.filter(
      (inst) => !groupedProvisionalIds.has(inst.id) && !dictSuggestedIds.has(inst.id),
    )

    return NextResponse.json({ provisionalCount, groups, singletons, dictionarySuggestions })
  } catch (error) {
    console.error("GET /api/instances/name-check:", error)
    return NextResponse.json({ error: "名寄せチェックに失敗しました" }, { status: 500 })
  }
}
