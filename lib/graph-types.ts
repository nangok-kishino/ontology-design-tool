// 新しいデータモデル（ラベル付きプロパティグラフ）の型定義。
// 設計の経緯と決まりごとは docs/graph-model.md を参照。
//
// 旧モデル（lib/types.ts）とは別のコンテナに保存し、切り替えが済むまで並走させる。
// 共通部（承認機構・グループ・整理用フィールド・成立条件）は旧モデルから持ち込む。

import type {
  ConfirmationEvent,
  ConditionValue,
  OrganizableFields,
  RelationConditionSlot,
} from "./types"

export type { ConfirmationEvent, ConditionValue, OrganizableFields }

// 成立条件の「項目」。リレーションシップタイプが宣言し、値は個々のリレーションシップが持つ。
export type ConditionSlot = RelationConditionSlot

// リレーションシップ1件が持つ条件の値。キーは ConditionSlot.id。
export type RelationshipConditions = Record<string, ConditionValue>

// ─────────────────────────────────────────────
// ラベル（旧クラス）
//   親子関係は持たない。上位・下位の関係は、ノードに両方のラベルを付けることで表す。
// ─────────────────────────────────────────────

// 予約ラベル。プロジェクト作成時に自動で用意し、改名・削除をさせない。
//   "category" : カテゴリノード（クラスそのものを表すノード）に付ける
export type SystemLabel = "category"

export const CATEGORY_LABEL_NAME = "カテゴリ"

export type Label = {
  id: string
  projectId: string
  name: string
  nameEn?: string
  // 同義語：文書中でこのラベルを指す別の呼び方（例：商品ラベルの「製品」）。
  // 個体の言い換えである「別名」（GraphNode.aliases）とは別物。
  synonyms?: string[]
  description: string
  // 予約ラベルのときだけ入る。通常のラベルは未設定。
  system?: SystemLabel
  createdBy?: string
  updatedBy?: string
  createdAt: string
  updatedAt: string
  confirmations?: ConfirmationEvent[]
} & OrganizableFields

// ─────────────────────────────────────────────
// リレーションシップタイプ（旧リレーション）
//   始点・終点のラベルは事前に宣言する。これが
//     1) スキーマビューの辺  2) 型チェック  3) 抽出のガードレール
//   の3つを担う。
// ─────────────────────────────────────────────
export type LabelPair = {
  sourceLabelId: string
  targetLabelId: string
}

export type RelationshipType = {
  id: string
  projectId: string
  name: string
  nameEn?: string
  description: string
  labelPairs: LabelPair[]
  // 成立条件の項目（具体値は持たない。値はリレーションシップ側）
  conditions?: ConditionSlot[]
  parentRelTypeId?: string | null
  createdBy?: string
  updatedBy?: string
  createdAt: string
  updatedAt: string
  confirmations?: ConfirmationEvent[]
} & OrganizableFields

// ─────────────────────────────────────────────
// ノード（旧インスタンス）
//   ラベルを複数持つ。旧モデルで子クラスに属していたものは、祖先のラベルも併せ持つ。
// ─────────────────────────────────────────────

// 名寄せのライフサイクル。旧 InstanceStatus をそのまま引き継ぐ。
//   provisional 登録済み・名寄せ未チェック
//   confirmed   名寄せチェック済み
//   merged      統合済み（不採用側）。既定で非表示
// 未設定の既存データは confirmed 相当として扱う。
export type NodeStatus = "provisional" | "confirmed" | "merged"

export type GraphNode = {
  id: string
  projectId: string
  name: string
  // 付与されたラベル。空配列＝ラベルなし。表示順もこの順に従う。
  labelIds: string[]
  // プロパティ値。キーは【プロパティ名】（PropertyDef.id ではない）。
  // Neo4j のプロパティは名前で引くものであり、ラベルをまたいだ同名プロパティを
  // ひとつにまとめるにもこの形が要る。
  properties?: Record<string, string>
  order?: number
  // --- 名寄せ ---
  status?: NodeStatus
  // 照合キー（lib/normalize.ts の normalizeName(name)）
  normalizedName?: string
  // このノードが代表として吸収した別名（表記揺れ）
  aliases?: string[]
  mergedInto?: string | null
  registeredBy: string
  registeredAt: string
  updatedBy: string
  updatedAt: string
  confirmations?: ConfirmationEvent[]
}

// ─────────────────────────────────────────────
// プロパティ定義（旧属性）
//   ノードが持てるプロパティは「付与された全ラベルのプロパティの和集合」＋プロジェクト共通。
//   同名のプロパティが複数のラベルにある場合は、同一のものとして1欄にまとめる。
// ─────────────────────────────────────────────
export type PropertyTarget = "label" | "relationshipType" | "project"
export type PropertyRequired = "必須" | "任意"

export type PropertyDef = {
  id: string
  projectId: string
  name: string
  description: string
  dataType: string
  required: PropertyRequired
  targetType: PropertyTarget
  // targetType==="project" のときは projectId が入る
  targetId: string
  createdAt: string
  updatedAt: string
}

// ─────────────────────────────────────────────
// リレーションシップ（旧トリプレット）
//   (始点ノード)─[リレーションシップタイプ]→(終点ノード)
//   旧 ClassTriplet（端がクラスのもの）は、カテゴリノードを作ることでこの形に収まる。
// ─────────────────────────────────────────────
export type Relationship = {
  id: string
  projectId: string
  startNodeId: string
  relTypeId: string
  endNodeId: string
  // 表示・エクスポート安定用のスナップショット（作成／承認当時の名前とラベル）
  startNodeName: string
  startNodeLabelIds: string[]
  relTypeName: string
  endNodeName: string
  endNodeLabelIds: string[]
  // このリレーションシップ固有のプロパティ値。キーはプロパティ名。
  properties?: Record<string, string>
  // 成立に要る条件の値。キーは ConditionSlot.id。入っていない項目は「使わない」。
  conditions?: RelationshipConditions
  sourceDocName?: string
  evidence?: string
  sourceCandidateId?: string
  order?: number
  approvedBy: string
  approvedAt: string
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
  confirmations?: ConfirmationEvent[]
}

// ─────────────────────────────────────────────
// 名寄せ辞書（確定した名寄せ結果）。1件＝1つの「別名→代表ノード」対応。
// ─────────────────────────────────────────────
export type NameResolutionMethod = "normalize" | "ngram" | "yomi" | "llm" | "manual"

export type NodeNameResolution = {
  id: string
  projectId: string
  // スコープ（ラベル単位で辞書を分ける場合。未設定＝プロジェクト全体）
  labelId?: string | null
  alias: string
  normalizedAlias: string
  canonicalNodeId: string
  method: NameResolutionMethod
  approvedBy: string
  approvedAt: string
}

// ─────────────────────────────────────────────
// コンテナ名。旧モデルのコンテナとは別にする（切り替えが済むまで並走）。
// ─────────────────────────────────────────────
export const CONTAINERS = {
  labels: "labels",
  relationshipTypes: "relationshipTypes",
  nodes: "nodes",
  relationships: "relationships",
  propertyDefs: "propertyDefs",
  nodeNameResolutions: "nodeNameResolutions",
  extractions: "extractions",
} as const

// ─────────────────────────────────────────────
// ラベルペアの照合。旧モデルの祖先チェーン探索は要らなくなり、
// 「ノードのラベルにそれが含まれるか」だけで済む。
// ─────────────────────────────────────────────
export function pairAllows(
  pair: LabelPair,
  startLabelIds: string[] | undefined,
  endLabelIds: string[] | undefined,
): boolean {
  return (
    !!startLabelIds?.includes(pair.sourceLabelId) &&
    !!endLabelIds?.includes(pair.targetLabelId)
  )
}

export function relTypeAllows(
  relType: Pick<RelationshipType, "labelPairs">,
  startLabelIds: string[] | undefined,
  endLabelIds: string[] | undefined,
): boolean {
  if (!startLabelIds?.length || !endLabelIds?.length) return false
  return (relType.labelPairs ?? []).some((p) => pairAllows(p, startLabelIds, endLabelIds))
}

// 受け取った入力をラベルペアに整える（両端が埋まっているものだけ・重複は落とす）。
// APIの入口で使う。参照先ラベルが実在するかは normalizeLabelPairs で見る。
export function cleanLabelPairs(input: unknown): LabelPair[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const out: LabelPair[] = []
  for (const p of input) {
    const s = typeof p?.sourceLabelId === "string" ? p.sourceLabelId : ""
    const t = typeof p?.targetLabelId === "string" ? p.targetLabelId : ""
    if (!s || !t) continue
    const key = `${s}|${t}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ sourceLabelId: s, targetLabelId: t })
  }
  return out
}

// 保存・表示の前にラベルペアを整える。
//   - 重複を落とす
//   - 参照先ラベルが存在しないペアを落とす
// 旧モデルにあった「親のペアで説明できる子のペアを畳む」処理は、階層が無いので不要。
export function normalizeLabelPairs(
  pairs: LabelPair[] | undefined,
  labelIds: Set<string>,
): LabelPair[] {
  const list = pairs ?? []
  if (labelIds.size === 0 || list.length === 0) return list
  const seen = new Set<string>()
  const out: LabelPair[] = []
  for (const p of list) {
    if (!labelIds.has(p.sourceLabelId) || !labelIds.has(p.targetLabelId)) continue
    const key = `${p.sourceLabelId}|${p.targetLabelId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out
}
