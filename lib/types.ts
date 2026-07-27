// Cosmos DB エンティティ型定義

export type Project = {
  id: string
  name: string
  description: string
  // 閲覧可能ドメイン一覧（空/未設定＝ドメイン制限なしのパブリックプロジェクト）
  allowedDomains?: string[]
  createdBy?: string
  createdAt: string
  updatedAt: string
}

export type OntologyClass = {
  id: string
  projectId: string
  name: string
  nameEn?: string
  description: string
  parentId: string | null
  createdBy?: string
  updatedBy?: string
  createdAt: string
  updatedAt: string
}

export type ClassPair = {
  sourceClassId: string
  targetClassId: string
}

export type OntologyRelation = {
  id: string
  projectId: string
  name: string
  nameEn?: string
  description: string
  classPairs: ClassPair[]
  parentRelationId: string | null
  createdBy?: string
  updatedBy?: string
  createdAt: string
  updatedAt: string
}

export type AttributeRequired = "必須" | "任意"
export type AttributeScope = "共通" | "固有"
export type AttributeTargetType = "class" | "relation" | "project"

export type OntologyAttribute = {
  id: string
  projectId: string
  name: string
  description: string
  dataType: string
  required: AttributeRequired
  scope: AttributeScope
  targetId: string
  targetType: AttributeTargetType
  createdAt: string
  updatedAt: string
}

// インスタンスのライフサイクル状態（名寄せ設計）
//   provisional 仮登録: 全登録経路（手動追加/YAMLインポート/LLM候補採用）の初期状態
//   confirmed   本登録: 名寄せチェックで承認済み。将来のトリプレット作成で利用可
//   merged      統合済み: 名寄せで不採用となった側。物理削除せず保持し、既定で非表示
// 後方互換: status 未設定の既存データは confirmed 相当（旧登録モデルで登録済み）として扱う。
// 判定は lib/instance-status.ts の instanceStatus() 経由で行うこと。
export type InstanceStatus = "provisional" | "confirmed" | "merged"

export type OntologyInstance = {
  id: string
  projectId: string
  name: string
  classId: string | null
  registeredBy: string
  registeredAt: string
  updatedBy: string
  updatedAt: string
  order?: number
  attributes?: Record<string, string>
  // --- 名寄せ関連（フェーズ1で追加） ---
  status?: InstanceStatus
  // 照合キー（lib/normalize.ts の normalizeName(name)）。未設定の既存データは
  // 読み取り側で name から都度算出してフォールバックする。
  normalizedName?: string
  // このインスタンスが代表として吸収した別名（表記揺れ）の一覧
  aliases?: string[]
  // status==="merged" のとき、統合先（代表）インスタンスの id
  mergedInto?: string | null
}

// 名寄せ辞書（確定した名寄せ結果の永続レコード）。1件＝1つの「別名→代表」対応。
// すべての照合手法（正規化/n-gram/読み/LLM）の承認結果がここに集約される。
export type NameResolutionMethod = "normalize" | "ngram" | "yomi" | "llm" | "manual"

export type NameResolution = {
  id: string
  projectId: string
  // スコープ（クラス単位で辞書を分ける場合。未設定＝プロジェクト全体）
  classId?: string | null
  alias: string // 別名・表記揺れ側の元表記
  normalizedAlias: string // normalizeName(alias)。辞書引きの照合キー
  canonicalInstanceId: string // 代表インスタンスの id
  method: NameResolutionMethod // 承認の根拠となった照合手法
  approvedBy: string
  approvedAt: string
}

export type CandidateType = "class" | "relation"
export type CandidateStatus = "確認中" | "承認済み" | "却下"

export type LLMCandidate = {
  id: string
  projectId: string
  type: CandidateType
  name: string
  description: string
  status: CandidateStatus
  sourceClassName?: string
  targetClassName?: string
  reviewedBy?: string
  reviewedAt?: string
  createdAt: string
  updatedAt: string
}
