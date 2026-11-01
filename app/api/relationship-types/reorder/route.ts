import { createReorderHandler } from "@/lib/reorder-handler"
import { CONTAINERS } from "@/lib/graph-types"

// グループは移行元のリレーションと同じ一覧（Project.relationGroups）をそのまま使う。
export const POST = createReorderHandler(CONTAINERS.relationshipTypes, "リレーションシップタイプ", "relation")
