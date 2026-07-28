import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { getPrincipalName } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/project-access"
import {
  extractTextFromFile,
  extractOntology,
  extractTriplets,
  type OntologyResult,
} from "@/lib/ingest"
import { isConfirmed } from "@/lib/instance-status"
import { classifyTriplet, resolveCandidate } from "@/lib/triplet-resolve"
import type { OntologyClass, OntologyInstance, OntologyRelation, Triplet, TripletCandidate } from "@/lib/types"

const INGESTIONS = "ingestions"
const CANDIDATES = "tripletCandidates"

// 取込みセッション（最新の保留オントロジー候補をプロジェクト単位で1件保持）。
// 全体（オントロジー側）の文書取込み画面が読み込む。id = projectId で upsert。
type IngestionRecord = {
  id: string
  projectId: string
  sourceDocName: string
  model: string
  ontology: OntologyResult
  createdBy: string
  createdAt: string
}

// 保存済みの保留オントロジー候補を返す（全体の文書取込み画面が起動時に読む）。
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get("projectId")
    if (!projectId) return NextResponse.json({ error: "projectIdが必要です" }, { status: 400 })
    const access = await checkProjectAccess(request, projectId)
    if ("error" in access) return access.error
    const container = await getContainer(INGESTIONS)
    const { resource } = await container.item(projectId, projectId).read<IngestionRecord>()
    if (!resource) return NextResponse.json({ ontology: null })
    return NextResponse.json({ ontology: resource.ontology, sourceDocName: resource.sourceDocName, model: resource.model })
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ ontology: null })
    console.error("GET /api/ingest:", error)
    return NextResponse.json({ error: "取込み結果の取得に失敗しました" }, { status: 500 })
  }
}

// 1回の取込みで、オントロジー抽出（主）とトリプレット抽出（従属）を両方実行し、
// 両画面が参照できるよう永続化する。どちらの文書取込みメニューから呼ばれても同じ挙動。
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const projectId = formData.get("projectId") as string | null
    const model = (formData.get("model") as string | null) ?? "claude-opus-4-8"

    if (!file) return NextResponse.json({ error: "ファイルが見つかりません" }, { status: 400 })
    if (!projectId) return NextResponse.json({ error: "projectIdが必要です" }, { status: 400 })

    const access = await checkProjectAccess(request, projectId)
    if ("error" in access) return access.error

    const [classContainer, relContainer, instContainer, tripletContainer, candContainer, ingestContainer] = await Promise.all([
      getContainer("classes"),
      getContainer("relations"),
      getContainer("instances"),
      getContainer("triplets"),
      getContainer(CANDIDATES),
      getContainer(INGESTIONS),
    ])
    const [{ resources: classes }, { resources: relationsRaw }, { resources: instancesAll }, { resources: existingTriplets }] = await Promise.all([
      classContainer.items.query<OntologyClass>({ query: "SELECT * FROM c WHERE c.projectId = @p", parameters: [{ name: "@p", value: projectId }] }).fetchAll(),
      relContainer.items.query<any>({ query: "SELECT * FROM c WHERE c.projectId = @p", parameters: [{ name: "@p", value: projectId }] }).fetchAll(),
      instContainer.items.query<OntologyInstance>({ query: "SELECT * FROM c WHERE c.projectId = @p", parameters: [{ name: "@p", value: projectId }] }).fetchAll(),
      tripletContainer.items.query<Triplet>({ query: "SELECT * FROM c WHERE c.projectId = @p", parameters: [{ name: "@p", value: projectId }] }).fetchAll(),
    ])
    const relations: OntologyRelation[] = relationsRaw.map((r) =>
      r.classPairs ? r : { ...r, classPairs: [{ sourceClassId: r.sourceClassId, targetClassId: r.targetClassId }] },
    )
    const classNameById = new Map(classes.map((c) => [c.id, c.name]))
    const confirmedInstances = instancesAll.filter((i) => isConfirmed(i))

    const text = await extractTextFromFile(file)
    if (!text.trim()) return NextResponse.json({ error: "テキストを抽出できませんでした" }, { status: 400 })

    const actor = getPrincipalName(request)
    const now = new Date().toISOString()

    // オントロジー抽出（主）とトリプレット抽出（従属）を並行実行
    const [ontology, tripletResult] = await Promise.all([
      extractOntology(model, text, { classes, relations, instances: instancesAll }),
      extractTriplets(model, text, { confirmedInstances, relations, classNameById }),
    ])

    // オントロジー候補を保留セッションとして保存（全体の文書取込み画面が読む）
    const ingestion: IngestionRecord = {
      id: projectId,
      projectId,
      sourceDocName: file.name,
      model,
      ontology,
      createdBy: actor,
      createdAt: now,
    }
    await ingestContainer.items.upsert(ingestion)

    // トリプレット候補を保存（同一文書は置き換え、既存本登録・重複は除外）
    const { resources: existingSameDoc } = await candContainer.items
      .query<TripletCandidate>({
        query: "SELECT * FROM c WHERE c.projectId = @p AND c.sourceDocName = @d",
        parameters: [{ name: "@p", value: projectId }, { name: "@d", value: file.name }],
      })
      .fetchAll()
    await Promise.all(existingSameDoc.map((c) => candContainer.item(c.id, c.id).delete().catch(() => {})))

    const existingKeys = new Set(existingTriplets.map((t) => `${t.subjectInstanceId}|${t.predicateRelationId}|${t.objectInstanceId}`))
    const seen = new Set<string>()
    const savedCandidates: TripletCandidate[] = []
    for (const t of tripletResult.triplets) {
      const key = `${t.subjectInstanceId}|${t.predicateRelationId}|${t.objectInstanceId}`
      if (existingKeys.has(key) || seen.has(key)) continue
      seen.add(key)
      const relation = relations.find((r) => r.id === t.predicateRelationId)!
      const subject = confirmedInstances.find((i) => i.id === t.subjectInstanceId)!
      const object = confirmedInstances.find((i) => i.id === t.objectInstanceId)!
      const cand: TripletCandidate = {
        id: crypto.randomUUID(),
        projectId,
        sourceDocName: file.name,
        subjectInstanceId: t.subjectInstanceId,
        predicateRelationId: t.predicateRelationId,
        objectInstanceId: t.objectInstanceId,
        subjectText: t.subjectName,
        predicateText: t.predicateName,
        objectText: t.objectName,
        evidence: t.evidence,
        confidence: t.confidence,
        createdBy: actor,
        createdAt: now,
        resolvedStatus: classifyTriplet({ subject, object, relation }),
      }
      const { resource } = await candContainer.items.create(cand)
      if (resource) savedCandidates.push(resource)
    }
    const resolvedCandidates = savedCandidates.map((c) => resolveCandidate(c, confirmedInstances, relations))

    let tripletNote: string | undefined
    if (confirmedInstances.length === 0 || relations.length === 0) {
      tripletNote = "本登録インスタンスと定義済みリレーションが揃っていないため、トリプレットは抽出できません。まずオントロジー設計（クラス・リレーション・インスタンスの本登録）を進めてください。"
    } else if (resolvedCandidates.length === 0) {
      tripletNote = "登録済みインスタンス同士が定義済みリレーションで結ばれる事実は、この文書からは見つかりませんでした。"
    } else if (tripletResult.dropped > 0) {
      tripletNote = `${tripletResult.dropped}件は定義済みオントロジー（登録済みインスタンス・定義済みリレーション・許可クラスペア）に適合しなかったため除外しました。`
    }

    return NextResponse.json({
      sourceDocName: file.name,
      model,
      ontology,
      candidates: resolvedCandidates,
      tripletNote,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("POST /api/ingest:", message)
    return NextResponse.json({ error: `取込みに失敗しました: ${message}` }, { status: 500 })
  }
}
