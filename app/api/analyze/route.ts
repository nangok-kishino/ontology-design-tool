import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"

const EXTRACT_TOOL = {
  type: "function" as const,
  function: {
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
              candidateType: {
                type: "string",
                enum: ["new", "merge"],
                description: "new: 新規インスタンス候補 / merge: 登録済みインスタンスとの統合候補",
              },
              suggestedClassId: { type: "string", description: "割当先の既存クラスID（candidateType=newの場合、なければ空文字）" },
              suggestedClassName: { type: "string", description: "割当先クラス名（既存または新規提案名）" },
              isNewClass: { type: "boolean", description: "適切な既存クラスがなく新規クラス作成が必要ならtrue（candidateType=newの場合のみ）" },
              newClassName: { type: "string", description: "新規クラス名（isNewClass=trueの場合）" },
              newClassDescription: { type: "string", description: "新規クラスの説明（isNewClass=trueの場合、1〜2文）" },
              existingInstanceId: { type: "string", description: "統合候補の登録済みインスタンスID（candidateType=mergeの場合）" },
              existingInstanceName: { type: "string", description: "統合候補の登録済みインスタンス名（candidateType=mergeの場合）" },
            },
            required: ["name", "candidateType", "suggestedClassName", "isNewClass"],
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
  },
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
    const validInstanceIds = new Set<string>(instances.map((i: any) => i.id))
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

    // LLM解析（OpenAI API）
    const apiKey = process.env.OPENAI_API_KEY
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content:
              "あなたはオントロジーエンジニアです。提供された文書と定義済みクラス・リレーション・登録済みインスタンスを参照し、以下を抽出してください。\n\n" +
              "1. インスタンス候補：文書中の具体的な事例・対象・固有名詞を列挙し、次のように分類してください。\n" +
              "   - 【登録済みインスタンス】と同一または類似するものは candidateType: \"merge\" とし、existingInstanceId と existingInstanceName を指定してください。\n" +
              "   - 新規と判断したものは candidateType: \"new\" とし、既存クラスに割り当ててください（suggestedClassId と suggestedClassName を指定）。\n" +
              "   - 適切なクラスがない場合は isNewClass: true とし、新規クラス名と説明を提案してください。\n\n" +
              "2. リレーション候補：文書が示唆するクラス間の関係で、【定義済みリレーション】に含まれない組み合わせのみを挙げてください。",
          },
          {
            role: "user",
            content:
              `【定義済みクラス】\n${classListText}\n\n` +
              `【定義済みリレーション】（これらと重複しない候補のみ提案してください）\n${relListText}\n\n` +
              `【登録済みインスタンス】（これらと照合し、同一・類似のものは candidateType: "merge" にしてください）\n${instanceListText}\n\n` +
              `【文書】\n${text.slice(0, 12000)}`,
          },
        ],
        tools: [EXTRACT_TOOL],
        tool_choice: { type: "function", function: { name: "extract_ontology_candidates" } },
      }),
    })

    if (!openaiRes.ok) {
      const errBody = await openaiRes.text()
      throw new Error(`OpenAI API error ${openaiRes.status}: ${errBody}`)
    }

    const responseJson = await openaiRes.json()
    const toolCall = responseJson.choices?.[0]?.message?.tool_calls?.[0]
    if (!toolCall) {
      return NextResponse.json({ error: "解析結果を取得できませんでした" }, { status: 500 })
    }

    const result = JSON.parse(toolCall.function.arguments) as {
      instances: Array<{
        name: string
        candidateType?: "new" | "merge"
        suggestedClassId?: string
        suggestedClassName: string
        isNewClass: boolean
        newClassName?: string
        newClassDescription?: string
        existingInstanceId?: string
        existingInstanceName?: string
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
        const candidateType = inst.candidateType ?? "new"

        // クラスIDの検証
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

        // 統合候補の既存インスタンスID検証
        let existingInstanceId = inst.existingInstanceId ?? null
        let existingInstanceName = inst.existingInstanceName ?? ""
        if (candidateType === "merge" && existingInstanceId && !validInstanceIds.has(existingInstanceId)) {
          const matchByName = instances.find((i: any) => i.name === existingInstanceName)
          if (matchByName) {
            existingInstanceId = matchByName.id
            existingInstanceName = matchByName.name
          } else {
            existingInstanceId = null
          }
        }

        return {
          id: `ic-${now}-${i}`,
          name: inst.name,
          classId,
          className,
          isNewClass: candidateType === "new" && (inst.isNewClass || !classId),
          newClassName: inst.newClassName ?? (inst.isNewClass ? inst.suggestedClassName : ""),
          newClassDescription: inst.newClassDescription ?? "",
          candidateType,
          existingInstanceId,
          existingInstanceName,
          status: "確認中",
          saving: false,
        }
      }),
      relations: (result.relations ?? []).map((rel, i) => {
        const srcId = rel.sourceClassId && validClassIds.has(rel.sourceClassId) ? rel.sourceClassId : null
        const tgtId = rel.targetClassId && validClassIds.has(rel.targetClassId) ? rel.targetClassId : null
        // 名前でフォールバック
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
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error)
    const debug = {
      apiKeySet: !!process.env.OPENAI_API_KEY,
      apiKeyPrefix: process.env.OPENAI_API_KEY?.slice(0, 7) ?? "(unset)",
      errorStatus: error?.status,
      errorType: error?.error?.error?.type,
    }
    console.error("POST /api/analyze error:", { message, ...debug })
    return NextResponse.json({ error: `解析に失敗しました: ${message}`, debug }, { status: 500 })
  }
}
