import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { checkProjectAccess } from "@/lib/project-access"
import { isConfirmed } from "@/lib/instance-status"
import { resolveCandidate } from "@/lib/triplet-resolve"
import type { OntologyInstance, OntologyRelation, TripletCandidate } from "@/lib/types"

const CANDIDATES = "tripletCandidates"

// 保存済みの生candidateを、現在の本登録インスタンス・定義済みリレーションに対して
// 都度再解決して返す（LLM不要）。インスタンスを本登録するほど 未解決→正当/型矛盾 が埋まる。
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get("projectId")
    if (!projectId) return NextResponse.json({ error: "projectIdが必要です" }, { status: 400 })
    const access = await checkProjectAccess(request, projectId)
    if ("error" in access) return access.error

    const [candContainer, relContainer, instContainer] = await Promise.all([
      getContainer(CANDIDATES),
      getContainer("relations"),
      getContainer("instances"),
    ])
    const [{ resources: candidates }, { resources: relationsRaw }, { resources: instancesAll }] = await Promise.all([
      candContainer.items.query<TripletCandidate>({ query: "SELECT * FROM c WHERE c.projectId = @p", parameters: [{ name: "@p", value: projectId }] }).fetchAll(),
      relContainer.items.query<any>({ query: "SELECT * FROM c WHERE c.projectId = @p", parameters: [{ name: "@p", value: projectId }] }).fetchAll(),
      instContainer.items.query<OntologyInstance>({ query: "SELECT * FROM c WHERE c.projectId = @p", parameters: [{ name: "@p", value: projectId }] }).fetchAll(),
    ])
    const relations: OntologyRelation[] = relationsRaw.map((r) =>
      r.classPairs ? r : { ...r, classPairs: [{ sourceClassId: r.sourceClassId, targetClassId: r.targetClassId }] },
    )
    const confirmedInstances = instancesAll.filter((i) => isConfirmed(i))
    const resolved = candidates.map((c) => resolveCandidate(c, confirmedInstances, relations))
    return NextResponse.json(resolved)
  } catch (error) {
    console.error("GET /api/triplet-candidates:", error)
    return NextResponse.json({ error: "トリプレット候補の取得に失敗しました" }, { status: 500 })
  }
}
