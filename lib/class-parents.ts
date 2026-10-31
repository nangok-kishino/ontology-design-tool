import { getContainer } from "./cosmos"
import type { ClassLike } from "./relation-inherit"

// リレーションの継承判定（lib/relation-inherit.ts）に要るのは親子関係だけなので、
// クラス全体ではなく id と parentId だけを引く。
export async function loadClassParents(projectId: string): Promise<ClassLike[]> {
  const container = await getContainer("classes")
  const { resources } = await container.items
    .query<ClassLike>({
      query: "SELECT c.id, c.parentId FROM c WHERE c.projectId = @p",
      parameters: [{ name: "@p", value: projectId }],
    })
    .fetchAll()
  return resources
}
