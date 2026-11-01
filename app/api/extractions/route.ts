// LLMによる解析（AI活用）。
//   GET  ?projectId=  解析した文書の一覧（残っている候補の数つき）
//   POST (formData: file, projectId, schema, graph)  文書を解析して候補を保存する

import { NextRequest, NextResponse } from "next/server"
import { getPrincipalName } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/project-access"
import { extractTextFromFile } from "@/lib/ingest"
import { extractGraph, extractSchema } from "@/lib/llm-analysis"
import { extractionContainer, loadGraphContext, MAX_TEXT_CHARS, withoutText } from "@/lib/llm-analysis-server"
import {
  LLM_ANALYSIS_MODEL, pendingCount,
  type Extraction, type ExtractionSummary,
} from "@/lib/llm-analysis-types"

// 長い文書は LLM を何回か呼ぶので、時間がかかる。Vercel の Hobby プランの上限（300秒）に合わせる
export const maxDuration = 300

export async function GET(request: NextRequest) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId")
    if (!projectId) return NextResponse.json({ error: "projectId が必要です" }, { status: 400 })
    const access = await checkProjectAccess(request, projectId)
    if ("error" in access) return access.error

    const container = await extractionContainer()
    const { resources } = await container.items
      .query<Extraction>({
        query: "SELECT c.id, c.sourceDocName, c.targets, c.createdAt, c.createdBy, c.labels, c.relTypes, c.nodes, c.relationships FROM c WHERE c.projectId = @p",
        parameters: [{ name: "@p", value: projectId }],
      })
      .fetchAll()
    const list: ExtractionSummary[] = resources
      .map((e) => ({
        id: e.id, sourceDocName: e.sourceDocName, targets: e.targets, createdAt: e.createdAt, createdBy: e.createdBy,
        pending: pendingCount(e),
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return NextResponse.json(list)
  } catch (error) {
    console.error("GET /api/extractions:", error)
    return NextResponse.json({ error: "解析した文書の一覧を取得できませんでした" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData()
    const file = form.get("file") as File | null
    const projectId = form.get("projectId") as string | null
    const schema = form.get("schema") === "true"
    const graph = form.get("graph") === "true"
    if (!file) return NextResponse.json({ error: "ファイルを選んでください" }, { status: 400 })
    if (!projectId) return NextResponse.json({ error: "projectId が必要です" }, { status: 400 })
    if (!schema && !graph) return NextResponse.json({ error: "抽出対象を1つ以上選んでください" }, { status: 400 })
    const access = await checkProjectAccess(request, projectId)
    if ("error" in access) return access.error

    const text = (await extractTextFromFile(file)).trim()
    if (!text) return NextResponse.json({ error: "文書から文字を読み取れませんでした" }, { status: 400 })
    if (text.length > MAX_TEXT_CHARS) {
      return NextResponse.json(
        { error: `文書が長すぎます（${text.length.toLocaleString()}文字）。${MAX_TEXT_CHARS.toLocaleString()}文字以下に分けてください` },
        { status: 400 },
      )
    }

    const ctx = await loadGraphContext(projectId)
    const [schemaResult, graphResult] = await Promise.all([
      schema ? extractSchema(text, ctx) : null,
      graph ? extractGraph(text, ctx) : null,
    ])

    const now = new Date().toISOString()
    const item: Extraction = {
      id: crypto.randomUUID(),
      projectId,
      sourceDocName: file.name,
      targets: { schema, graph },
      model: LLM_ANALYSIS_MODEL,
      text,
      labels: schemaResult?.labels ?? [],
      relTypes: schemaResult?.relTypes ?? [],
      nodes: graphResult?.nodes ?? [],
      relationships: graphResult?.relationships ?? [],
      notes: [
        ...(schemaResult?.notes ?? []).map((n) => `［スキーマ］${n}`),
        ...(graphResult?.notes ?? []).map((n) => `［グラフ］${n}`),
      ],
      graphExtractedAt: graph ? now : undefined,
      createdBy: getPrincipalName(request),
      createdAt: now,
      updatedAt: now,
    }
    const container = await extractionContainer()
    const { resource } = await container.items.create(item)
    return NextResponse.json(withoutText(resource ?? item), { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("POST /api/extractions:", message)
    return NextResponse.json({ error: `解析に失敗しました：${message}` }, { status: 500 })
  }
}
