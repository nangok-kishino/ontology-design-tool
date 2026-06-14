import { NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { classTree } from "@/lib/ontology-data"
import type { OntologyClass } from "@/lib/types"

function flattenTree(nodes: any[], result: OntologyClass[] = []): OntologyClass[] {
  const now = new Date().toISOString()
  for (const node of nodes) {
    result.push({
      id: node.id,
      name: node.name,
      description: node.description,
      parentId: node.parentId,
      createdAt: now,
      updatedAt: now,
    })
    if (node.children?.length) {
      flattenTree(node.children, result)
    }
  }
  return result
}

// サンプルデータをDBに投入する（冪等：upsert）
export async function POST() {
  try {
    const container = await getContainer("classes")
    const classes = flattenTree(classTree)

    for (const cls of classes) {
      await container.items.upsert(cls)
    }

    return NextResponse.json({
      message: "クラスのサンプルデータを投入しました",
      count: classes.length,
    })
  } catch (error) {
    console.error("POST /api/seed:", error)
    return NextResponse.json({ error: "シードデータの投入に失敗しました" }, { status: 500 })
  }
}
