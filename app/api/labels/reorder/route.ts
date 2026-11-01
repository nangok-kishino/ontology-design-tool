import { createReorderHandler } from "@/lib/reorder-handler"
import { CONTAINERS } from "@/lib/graph-types"

// ラベルのグループは、移行元のクラスと同じ一覧（Project.classGroups）をそのまま使う。
export const POST = createReorderHandler(CONTAINERS.labels, "ラベル", "class")
