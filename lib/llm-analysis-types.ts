// LLMによる解析（AI活用）の候補の形。サーバとクライアントで共有する（SDK を import しない）。
//
// 1つの文書を解析した結果を Extraction として1件保存する。候補は人がアクションを選んで
// 実行するまで「pending」のまま残り、実行したら「done」と結果（outcome）を記録する。
// 自動で登録・名寄せすることはない（名寄せの原則：人の承認なしに既存データを変えない）。

export const LLM_ANALYSIS_MODEL = "claude-opus-5-5"
export const LLM_ANALYSIS_MODEL_LABEL = "Claude Opus 5.5"

export type CandidateStatus = "pending" | "done"

type CandidateBase = {
  id: string
  status: CandidateStatus
  // 実行後の結果の説明（「新規ラベルとして登録」「見送り」など）
  outcome?: string
  // 根拠となった原文の短い抜き出し
  evidence: string
}

// ─── スキーマ抽出 ───

export type LabelCandidate = CandidateBase & {
  name: string
  description: string
  // 既存類似ラベル（同義語登録の行き先）
  similarLabelId: string | null
  similarReason: string
  // 実行後に、このラベル候補が指すことになったラベル（新規ならその id、同義語なら寄せた先）
  resultLabelId?: string
}
export type LabelAction = "skip" | "synonym" | "new"

// 始点・終点の参照先。既存ラベルか、同じ解析のラベル候補か
export type LabelRef = { kind: "label"; id: string } | { kind: "candidate"; id: string }

export type RelTypeCandidate = CandidateBase & {
  name: string
  description: string
  source: LabelRef | null
  target: LabelRef | null
  // LLM が挙げた始点・終点の名前（参照先が見つからないときの表示用）
  sourceName: string
  targetName: string
  // 既存類似タイプ（ペア追加の行き先）
  similarTypeId: string | null
  similarReason: string
}
export type RelTypeAction = "skip" | "new" | "addPair"

// ─── グラフデータ抽出 ───

export type NodeCandidate = CandidateBase & {
  name: string
  // 文書中での元の表記（name は既存ノードの書き方に揃えたもの）
  sourceText: string
  labelIds: string[]
  properties: Record<string, string>
  similarNodeId: string | null
  similarReason: string
  resultNodeId?: string
}
export type NodeAction = "skip" | "new"

export type NodeRef = { kind: "node"; id: string } | { kind: "candidate"; id: string }

export type RelationshipCandidate = CandidateBase & {
  start: NodeRef
  relTypeId: string
  end: NodeRef
}
export type RelationshipAction = "skip" | "register"

export type ExtractionTargets = { schema: boolean; graph: boolean }

export type Extraction = {
  id: string
  projectId: string
  sourceDocName: string
  targets: ExtractionTargets
  model: string
  // 文書の本文。グラフデータ抽出をやり直すときに使う（一覧・詳細の応答には含めない）
  text?: string
  labels: LabelCandidate[]
  relTypes: RelTypeCandidate[]
  nodes: NodeCandidate[]
  relationships: RelationshipCandidate[]
  // 解析中に気づいたこと（読み飛ばした件数など）
  notes: string[]
  graphExtractedAt?: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

// 一覧用の要約
export type ExtractionSummary = Pick<Extraction, "id" | "sourceDocName" | "targets" | "createdAt" | "createdBy"> & {
  pending: number
}

export function pendingCount(e: Pick<Extraction, "labels" | "relTypes" | "nodes" | "relationships">): number {
  return [...e.labels, ...e.relTypes, ...e.nodes, ...e.relationships].filter((c) => c.status === "pending").length
}
