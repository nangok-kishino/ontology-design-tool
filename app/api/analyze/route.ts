import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { checkProjectAccess } from "@/lib/project-access"
import { extractTextFromFile, extractOntology } from "@/lib/ingest"
import type { OntologyClass, OntologyInstance, OntologyRelation } from "@/lib/types"

// 後方互換のためのオントロジー抽出専用エンドポイント。
// 抽出ロジックは共通エンジン（lib/ingest）に集約済み。両方を走らせる本流は /api/ingest。
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

    const [classContainer, relContainer, instContainer] = await Promise.all([
      getContainer("classes"),
      getContainer("relations"),
      getContainer("instances"),
    ])
    const [{ resources: classes }, { resources: relationsRaw }, { resources: instances }] = await Promise.all([
      classContainer.items.query<OntologyClass>({ query: "SELECT * FROM c WHERE c.projectId = @p", parameters: [{ name: "@p", value: projectId }] }).fetchAll(),
      relContainer.items.query<any>({ query: "SELECT * FROM c WHERE c.projectId = @p", parameters: [{ name: "@p", value: projectId }] }).fetchAll(),
      instContainer.items.query<OntologyInstance>({ query: "SELECT * FROM c WHERE c.projectId = @p", parameters: [{ name: "@p", value: projectId }] }).fetchAll(),
    ])
    const relations: OntologyRelation[] = relationsRaw.map((r) =>
      r.classPairs ? r : { ...r, classPairs: [{ sourceClassId: r.sourceClassId, targetClassId: r.targetClassId }] },
    )

    const text = await extractTextFromFile(file)
    if (!text.trim()) return NextResponse.json({ error: "テキストを抽出できませんでした" }, { status: 400 })

    const ontology = await extractOntology(model, text, { classes, relations, instances })
    return NextResponse.json(ontology)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("POST /api/analyze:", message)
    return NextResponse.json({ error: `解析に失敗しました: ${message}` }, { status: 500 })
  }
}
