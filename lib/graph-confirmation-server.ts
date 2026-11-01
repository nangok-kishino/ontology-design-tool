// サーバ側専用: プロパティ定義の増減を、持ち主（ラベル／リレーションシップタイプ）の
// 確認履歴に edit として残す。プロパティが変わればスキーマが変わったことになるため。

import { getContainer } from "@/lib/cosmos"
import { appendEditEvent } from "@/lib/confirmation"
import { CONTAINERS, type Label, type PropertyTarget, type RelationshipType } from "@/lib/graph-types"

export async function bumpOwnerEditEvent(
  targetType: PropertyTarget,
  targetId: string,
  actor: string,
): Promise<void> {
  const containerId =
    targetType === "label"
      ? CONTAINERS.labels
      : targetType === "relationshipType"
        ? CONTAINERS.relationshipTypes
        : null
  // project スコープのプロパティは持ち主が1つに定まらないので、履歴は残さない
  if (!containerId) return
  try {
    const container = await getContainer(containerId)
    const { resource } = await container.item(targetId, targetId).read<Label | RelationshipType>()
    if (!resource) return
    await container.item(targetId, targetId).replace({
      ...resource,
      confirmations: appendEditEvent(resource.confirmations, actor, ["properties"]),
    })
  } catch (error) {
    // 持ち主側の履歴追記に失敗しても本処理は止めない
    console.error("bumpOwnerEditEvent:", error)
  }
}
