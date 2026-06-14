import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"

const EXTRACT_TOOL: Anthropic.Tool = {
  name: "extract_ontology_candidates",
  description: "オントロジーのクラス候補とリレーション候補を抽出する",
  input_schema: {
    type: "object",
    properties: {
      classes: {
        type: "array",
        description: "クラス候補一覧",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "クラス名（日本語）" },
            description: { type: "string", description: "クラスの説明（1〜2文）" },
          },
          required: ["name", "description"],
        },
      },
      relations: {
        type: "array",
        description: "リレーション候補一覧",
        items: {
          type: "object",
          properties: {
            source: { type: "string", description: "始点クラス名" },
            name: { type: "string", description: "リレーション名（動詞句）" },
            target: { type: "string", description: "終点クラス名" },
            description: { type: "string", description: "リレーションの説明（1〜2文）" },
          },
          required: ["source", "name", "target", "description"],
        },
      },
    },
    required: ["classes", "relations"],
  },
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    if (!file) {
      return NextResponse.json({ error: "ファイルが見つかりません" }, { status: 400 })
    }

    // テキスト抽出
    let text = ""
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")

    if (isPdf) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod = await import("pdf-parse") as any
      const pdfParse = mod.default ?? mod
      const buffer = Buffer.from(await file.arrayBuffer())
      const data = await pdfParse(buffer)
      text = data.text
    } else {
      text = await file.text()
    }

    if (!text.trim()) {
      return NextResponse.json({ error: "テキストを抽出できませんでした" }, { status: 400 })
    }

    // Anthropic API でオントロジー候補を抽出
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system:
        "あなたはオントロジーエンジニアです。提供された文書から、主要な概念（クラス）とクラス間の関係（リレーション）を抽出してください。" +
        "クラスは文書中に登場する重要なエンティティや概念です。リレーション名は「〜は」「〜を持つ」などの動詞句で表してください。",
      tools: [EXTRACT_TOOL],
      tool_choice: { type: "tool", name: "extract_ontology_candidates" },
      messages: [
        {
          role: "user",
          content: `以下の文書からオントロジーのクラス候補とリレーション候補を抽出してください。\n\n文書:\n${text.slice(0, 15000)}`,
        },
      ],
    })

    const toolUse = response.content.find((c) => c.type === "tool_use")
    if (!toolUse || toolUse.type !== "tool_use") {
      return NextResponse.json({ error: "解析結果を取得できませんでした" }, { status: 500 })
    }

    const result = toolUse.input as {
      classes: Array<{ name: string; description: string }>
      relations: Array<{ source: string; name: string; target: string; description: string }>
    }

    const now = Date.now()
    return NextResponse.json({
      classes: result.classes.map((c, i) => ({
        id: `cc-${now}-${i}`,
        name: c.name,
        description: c.description,
        status: "確認中",
      })),
      relations: result.relations.map((r, i) => ({
        id: `rc-${now}-${i}`,
        source: r.source,
        name: r.name,
        target: r.target,
        description: r.description,
        status: "確認中",
      })),
    })
  } catch (error) {
    console.error("POST /api/analyze:", error)
    return NextResponse.json({ error: "解析に失敗しました" }, { status: 500 })
  }
}
