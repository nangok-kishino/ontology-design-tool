import { NextResponse } from "next/server"
import { getContainer } from "@/lib/cosmos"
import { classTree } from "@/lib/ontology-data"
import type { OntologyClass, Project } from "@/lib/types"

const DEFAULT_PROJECT_ID = "default-project"

function flattenTree(nodes: any[], projectId: string, result: OntologyClass[] = []): OntologyClass[] {
  const now = new Date().toISOString()
  for (const node of nodes) {
    result.push({
      id: node.id,
      projectId,
      name: node.name,
      description: node.description,
      parentId: node.parentId,
      createdAt: now,
      updatedAt: now,
    })
    if (node.children?.length) {
      flattenTree(node.children, projectId, result)
    }
  }
  return result
}

// サンプルデータをDBに投入する（冪等：upsert）
export async function POST() {
  try {
    // デフォルトプロジェクトを作成または取得
    const projectContainer = await getContainer("projects")
    let project: Project

    try {
      const { resource } = await projectContainer.item(DEFAULT_PROJECT_ID, DEFAULT_PROJECT_ID).read<Project>()
      project = resource!
    } catch {
      const now = new Date().toISOString()
      project = {
        id: DEFAULT_PROJECT_ID,
        name: "製造知識継承オントロジー",
        description: "製造現場での知識継承を目的としたオントロジーのサンプルプロジェクト",
        createdAt: now,
        updatedAt: now,
      }
      await projectContainer.items.upsert(project)
    }

    // クラスをプロジェクトIDつきでupsert
    const classContainer = await getContainer("classes")
    const classes = flattenTree(classTree, project.id)

    for (const cls of classes) {
      await classContainer.items.upsert(cls)
    }

    return NextResponse.json({
      message: "サンプルデータを投入しました",
      projectId: project.id,
      classCount: classes.length,
    })
  } catch (error) {
    console.error("POST /api/seed:", error)
    return NextResponse.json({ error: "シードデータの投入に失敗しました" }, { status: 500 })
  }
}
