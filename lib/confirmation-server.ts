// サーバ側専用: Cosmos DB へ確認履歴の edit イベントを追記するヘルパー。
// クラス／リレーション本体のフィールド編集だけでなく、
// 子エンティティ（属性など）の変更でも親側に edit を残せるようにする。

import { getContainer } from "@/lib/cosmos"
import { appendEditEvent } from "@/lib/confirmation"
import type { AttributeTargetType, OntologyClass, OntologyRelation } from "@/lib/types"

export async function bumpParentEditEvent(
  targetType: AttributeTargetType,
  targetId: string,
  actor: string,
  editedFields: string[],
): Promise<void> {
  if (editedFields.length === 0) return
  const containerId =
    targetType === "class" ? "classes" : targetType === "relation" ? "relations" : null
  if (!containerId) return
  try {
    const container = await getContainer(containerId)
    const { resource } = await container.item(targetId, targetId).read<OntologyClass | OntologyRelation>()
    if (!resource) return
    const updated = {
      ...resource,
      confirmations: appendEditEvent(resource.confirmations, actor, editedFields),
    }
    await container.item(targetId, targetId).replace(updated)
  } catch (error) {
    // 親側の履歴追記失敗は本処理を止めない
    console.error("bumpParentEditEvent:", error)
  }
}
