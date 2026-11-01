// 解析した1文書の候補。
//   GET     候補を返す
//   PATCH   アクションを実行した候補の結果を記録する（登録そのものは各画面と同じ API で済ませてある）
//   DELETE  解析結果ごと消す

import { NextRequest, NextResponse } from "next/server"
import { checkProjectAccess } from "@/lib/project-access"
import { extractionContainer, withoutText } from "@/lib/llm-analysis-server"
import type { Extraction } from "@/lib/llm-analysis-types"

type CandidateUpdate = { id: string; outcome: string; resultLabelId?: string; resultNodeId?: string }
type Kind = "labels" | "relTypes" | "nodes" | "relationships"
const KINDS: Kind[] = ["labels", "relTypes", "nodes", "relationships"]

async function load(request: NextRequest, id: string) {
  const container = await extractionContainer()
  const { resource } = await container.item(id, id).read<Extraction>()
  if (!resource) return { error: NextResponse.json({ error: "見つかりません" }, { status: 404 }) }
  const access = await checkProjectAccess(request, resource.projectId)
  if ("error" in access) return { error: access.error }
  return { container, resource }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const r = await load(request, id)
    if ("error" in r) return r.error
    return NextResponse.json(withoutText(r.resource))
  } catch (error: any) {
    if (error?.code === 404) return NextResponse.json({ error: "見つかりません" }, { status: 404 })
    console.error("GET /api/extractions/[id]:", error)
    return NextResponse.json({ error: "解析結果を取得できませんでした" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const r = await load(request, id)
    if ("error" in r) return r.error
    const next: Extraction = { ...r.resource, updatedAt: new Date().toISOString() }
    for (const kind of KINDS) {
      const updates: CandidateUpdate[] = Array.isArray(body?.[kind]) ? body[kind] : []
      if (updates.length === 0) continue
      const byId = new Map(updates.map((u) => [u.id, u]))
      // 候補の型ごとに結果の欄が違うので、共通の欄だけを書き換える
      next[kind] = (next[kind] as { id: string }[]).map((c) => {
        const u = byId.get(c.id)
        if (!u) return c
        return {
          ...c, status: "done", outcome: u.outcome,
          ...(u.resultLabelId ? { resultLabelId: u.resultLabelId } : {}),
          ...(u.resultNodeId ? { resultNodeId: u.resultNodeId } : {}),
        }
      }) as never
    }
    const { resource } = await r.container.item(id, id).replace(next)
    return NextResponse.json(withoutText(resource ?? next))
  } catch (error) {
    console.error("PATCH /api/extractions/[id]:", error)
    return NextResponse.json({ error: "結果を記録できませんでした" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const r = await load(request, id)
    if ("error" in r) return r.error
    await r.container.item(id, id).delete()
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    console.error("DELETE /api/extractions/[id]:", error)
    return NextResponse.json({ error: "解析結果を削除できませんでした" }, { status: 500 })
  }
}
