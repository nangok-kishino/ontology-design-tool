import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { getContainer } from "@/lib/cosmos"

const SYSTEM_INSTRUCTION =
  "あなたはオントロジーエンジニアです。提供された文書と定義済みクラス・リレーション・登録済みインスタンスを参照し、以下を抽出してください。\n\n" +
  "1. インスタンス候補：文書中の具体的な事例・対象・固有名詞のうち、【登録済みインスタンス】に一致・類似するものは除外し、新規性のあるものだけを列挙してください。既存クラスに割り当ててください（suggestedClassId と suggestedClassName を指定）。適切なクラスがない場合は isNewClass: true とし、新規クラス名と説明を提案してください。\n\n" +
  "2. リレーション候補：文書が示唆するクラス間の関係で、【定義済みリレーション】に含まれない組み合わせのみを挙げてください。"

const EXTRACT_FUNCTION = {
  name: "extract_ontology_candidates",
  description: "文書からインスタンス候補と新規リレーション候補を抽出する",
  parameters: {
    type: "object",
    properties: {
      instances: {
        type: "array",
        description: "文書中の具体的なインスタンス候補（特定の事例・対象・固有名詞）",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "インスタンス候補名" },
            suggestedClassId: { type: "string", description: "割当先の既存クラスID（なければ空文字）" },
            suggestedClassName: { type: "string", description: "割当先クラス名（既存または新規提案名）" },
            isNewClass: { type: "boolean", description: "適切な既存クラスがなく新規クラス作成が必要ならtrue" },
            newClassName: { type: "string", description: "新規クラス名（isNewClass=trueの場合）" },
            newClassDescription: { type: "string", description: "新規クラスの説明（isNewClass=trueの場合、1〜2文）" },
          },
          required: ["name", "suggestedClassName", "isNewClass"],
        },
      },
      relations: {
        type: "array",
        description: "既存リレーションに含まれない新たなクラス間関係の候補",
        items: {
          type: "object",
          properties: {
            sourceClassId: { type: "string", description: "始点クラスのID（既存クラスから。不明なら空文字）" },
            sourceClassName: { type: "string", description: "始点クラス名" },
            relationName: { type: "string", description: "リレーション名（動詞句）" },
            targetClassId: { type: "string", description: "終点クラスのID（既存クラスから。不明なら空文字）" },
            targetClassName: { type: "string", description: "終点クラス名" },
            description: { type: "string", description: "リレーションの説明（1〜2文）" },
          },
          required: ["sourceClassName", "relationName", "targetClassName", "description"],
        },
      },
    },
    required: ["instances", "relations"],
  },
}

async function callGemini(model: string, systemInstruction: string, userContent: string) {
  const apiKey = process.env.GEMINI_API_KEY
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: userContent }] }],
        tools: [{ function_declarations: [EXTRACT_FUNCTION] }],
        tool_config: {
          function_calling_config: { mode: "ANY", allowed_function_names: [EXTRACT_FUNCTION.name] },
        },
      }),
    }
  )
  if (!res.ok) throw new Error(`Gemini API error ${res.status}: ${await res.text()}`)
  const json = await res.json()
  const part = (json.candidates?.[0]?.content?.parts ?? []).find((p: any) => p.functionCall)
  if (!part?.functionCall) throw new Error("解析結果を取得できませんでした（Gemini）")
  return part.functionCall.args
}

async function callAnthropic(model: string, systemInstruction: string, userContent: string) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const msg = await anthropic.messages.create({
    model,
    max_tokens: 8192,
    system: systemInstruction,
    tools: [{
      name: EXTRACT_FUNCTION.name,
      description: EXTRACT_FUNCTION.description,
      input_schema: EXTRACT_FUNCTION.parameters as any,
    }],
    tool_choice: { type: "tool", name: EXTRACT_FUNCTION.name },
    messages: [{ role: "user", content: userContent }],
  })
  const toolUse = msg.content.find((b) => b.type === "tool_use")
  if (!toolUse || toolUse.type !== "tool_use") throw new Error("解析結果を取得できませんでした（Claude）")
  return toolUse.input as any
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const projectId = formData.get("projectId") as string | null

    if (!file) return NextResponse.json({ error: "ファイルが見つかりません" }, { status: 400 })
    if (!projectId) return NextResponse.json({ error: "projectIdが必要です" }, { status: 400 })

    // 既存クラス・リレーションをDBから取得
    const [classContainer, relContainer, instContainer] = await Promise.all([
      getContainer("classes"),
      getContainer("relations"),
      getContainer("instances"),
    ])
    const [{ resources: classes }, { resources: relationsRaw }, { resources: instances }] = await Promise.all([
      classContainer.items.query<any>({
        query: "SELECT * FROM c WHERE c.projectId = @p",
        parameters: [{ name: "@p", value: projectId }],
      }).fetchAll(),
      relContainer.items.query<any>({
        query: "SELECT * FROM c WHERE c.projectId = @p",
        parameters: [{ name: "@p", value: projectId }],
      }).fetchAll(),
      instContainer.items.query<any>({
        query: "SELECT * FROM c WHERE c.projectId = @p",
        parameters: [{ name: "@p", value: projectId }],
      }).fetchAll(),
    ])

    const classIdMap = new Map<string, string>(classes.map((c: any) => [c.id, c.name]))
    const validClassIds = new Set<string>(classes.map((c: any) => c.id))
    const relations = relationsRaw.map((r: any) =>
      r.classPairs ? r : { ...r, classPairs: [{ sourceClassId: r.sourceClassId, targetClassId: r.targetClassId }] }
    )

    // テキスト抽出
    let text = ""
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
    if (isPdf) {
      const { default: pdfParse } = await import("pdf-parse")
      const buffer = Buffer.from(await file.arrayBuffer())
      const data = await pdfParse(buffer)
      text = data.text
    } else {
      text = await file.text()
    }
    if (!text.trim()) return NextResponse.json({ error: "テキストを抽出できませんでした" }, { status: 400 })

    // LLMへ渡すコンテキスト構築
    const classListText = classes.length > 0
      ? classes.map((c: any) =>
          `- ID: ${c.id}, 名前: ${c.name}${c.nameEn ? ` (${c.nameEn})` : ""}, 説明: ${c.description || "なし"}`
        ).join("\n")
      : "（定義済みクラスなし）"

    const relListText = relations.length > 0
      ? relations.map((r: any) => {
          const pairsText = ((r.classPairs ?? []) as any[]).map((p) =>
            `${classIdMap.get(p.sourceClassId) ?? p.sourceClassId} → ${classIdMap.get(p.targetClassId) ?? p.targetClassId}`
          ).join(", ")
          return `- 名前: ${r.name}${r.nameEn ? ` (${r.nameEn})` : ""}, ペア: ${pairsText}`
        }).join("\n")
      : "（定義済みリレーションなし）"

    const instanceListText = instances.length > 0
      ? instances.map((i: any) => {
          const cls = classIdMap.get(i.classId ?? "") ?? "未分類"
          return `- ID: ${i.id}, 名前: ${i.name}, クラス: ${cls}`
        }).join("\n")
      : "（登録済みインスタンスなし）"

    // LLM解析（ユーザーが選択したモデルに応じてプロバイダーを振り分け）
    const model = (formData.get("model") as string | null) ?? "claude-opus-4-8"
    const userContent =
      `【定義済みクラス】\n${classListText}\n\n` +
      `【定義済みリレーション】（これらと重複しない候補のみ提案してください）\n${relListText}\n\n` +
      `【登録済みインスタンス】（これらと同一・類似のものは候補に含めないでください）\n${instanceListText}\n\n` +
      `【文書】\n${text.slice(0, 12000)}`

    const rawResult = model.startsWith("claude-")
      ? await callAnthropic(model, SYSTEM_INSTRUCTION, userContent)
      : await callGemini(model, SYSTEM_INSTRUCTION, userContent)

    const result = rawResult as {
      instances: Array<{
        name: string
        suggestedClassId?: string
        suggestedClassName: string
        isNewClass: boolean
        newClassName?: string
        newClassDescription?: string
      }>
      relations: Array<{
        sourceClassId?: string
        sourceClassName: string
        relationName: string
        targetClassId?: string
        targetClassName: string
        description: string
      }>
    }

    const now = Date.now()

    return NextResponse.json({
      instances: (result.instances ?? []).map((inst, i) => {
        let classId: string | null = null
        let className = ""
        if (inst.suggestedClassId && validClassIds.has(inst.suggestedClassId)) {
          classId = inst.suggestedClassId
          className = classIdMap.get(classId) ?? ""
        } else if (!inst.isNewClass) {
          const matchByName = classes.find((c: any) => c.name === inst.suggestedClassName)
          if (matchByName) {
            classId = matchByName.id
            className = matchByName.name
          }
        }

        return {
          id: `ic-${now}-${i}`,
          name: inst.name,
          classId,
          className,
          isNewClass: inst.isNewClass || !classId,
          newClassName: inst.newClassName ?? (inst.isNewClass ? inst.suggestedClassName : ""),
          newClassDescription: inst.newClassDescription ?? "",
          status: "確認中",
          saving: false,
        }
      }),
      relations: (result.relations ?? []).map((rel, i) => {
        const srcId = rel.sourceClassId && validClassIds.has(rel.sourceClassId) ? rel.sourceClassId : null
        const tgtId = rel.targetClassId && validClassIds.has(rel.targetClassId) ? rel.targetClassId : null
        const srcByName = !srcId ? classes.find((c: any) => c.name === rel.sourceClassName) : null
        const tgtByName = !tgtId ? classes.find((c: any) => c.name === rel.targetClassName) : null
        const resolvedSrcId = srcId ?? srcByName?.id ?? null
        const resolvedTgtId = tgtId ?? tgtByName?.id ?? null
        return {
          id: `rc-${now}-${i}`,
          sourceClassId: resolvedSrcId,
          sourceClassName: resolvedSrcId ? (classIdMap.get(resolvedSrcId) ?? rel.sourceClassName) : rel.sourceClassName,
          relationName: rel.relationName,
          targetClassId: resolvedTgtId,
          targetClassName: resolvedTgtId ? (classIdMap.get(resolvedTgtId) ?? rel.targetClassName) : rel.targetClassName,
          description: rel.description,
          status: "確認中",
          saving: false,
        }
      }),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const debug = {
      geminiKeySet: !!process.env.GEMINI_API_KEY,
      anthropicKeySet: !!process.env.ANTHROPIC_API_KEY,
    }
    console.error("POST /api/analyze:", { message, ...debug })
    return NextResponse.json({ error: `解析に失敗しました: ${message}`, debug }, { status: 500 })
  }
}
