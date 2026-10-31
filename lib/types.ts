// Cosmos DB エンティティ型定義

// ─────────────────────────────────────────────
// 確認（承認）機構
//   クラス／リレーション／インスタンス／トリプレットに対して、専門家が
//   「これでOK」と承認したことを示す。ConfirmationEvent の配列として
//   各エンティティに埋め込む。
//   - "confirm"    : 確認レコード。confirmerName は自由入力（複数人可）。
//   - "unconfirm"  : 確認取り消しレコード。
//   - "edit"       : 対象エンティティ自身のフィールドが変更されたことを示す。
//                    最新の confirm 以降に edit が存在する場合は「確認済み*」表示。
//   派生状態は lib/confirmation.ts の deriveConfirmationStatus() で判定する。
// ─────────────────────────────────────────────
export type ConfirmationEventType = "confirm" | "unconfirm" | "edit"

export type ConfirmationEvent = {
  type: ConfirmationEventType
  at: string
  // 操作したログインユーザー名（システムが自動記録）
  actor: string
  // type==="confirm" のときの確認者名。手入力・自由記述（複数人可）
  confirmerName?: string
  // type==="edit" のときに変更されたフィールドキー
  editedFields?: string[]
}

// ─────────────────────────────────────────────
// 整理用グループ
//   クラス／リレーションを人が把握しやすいように束ねるだけの「整理の都合」。
//   オントロジーの意味ではないので、Neo4jエクスポートにもLLMプロンプトにも渡さない。
//   （Neo4j出力はインスタンスとトリプレットのみを対象とするため、クラス／リレーションに
//    このフィールドを持たせても構造上エクスポートには現れない。lib/graph-export.ts 参照）
//   クラスの継承（parentId）とは独立した軸であることに注意。継承は意味、グループは整理。
//   クラス用とリレーション用で一覧を完全に分ける。名前が同じでも別のグループとして扱う。
//   定義は Project ドキュメントに埋め込む。プロジェクトはアクセス確認で必ず読むため、
//   画面表示時の問い合わせを増やさずに済む。
// ─────────────────────────────────────────────
export type OntologyGroup = {
  id: string
  name: string
  // 一覧・図での色分け用（CSSカラー。未設定＝色なし）
  color?: string
  order: number
}

// グループ一覧の対象。クラス用とリレーション用は互いに独立している。
export type GroupTarget = "class" | "relation"

export type Project = {
  id: string
  name: string
  description: string
  // 閲覧可能ドメイン一覧（空/未設定＝ドメイン制限なしのパブリックプロジェクト）
  allowedDomains?: string[]
  // 整理用グループの定義一覧。クラス用とリレーション用は別物として持つ。
  classGroups?: OntologyGroup[]
  relationGroups?: OntologyGroup[]
  // 旧フィールド（クラス・リレーション共用だった頃の一覧）。
  // 読み取り時はリレーション用として引き継ぎ、保存時に relationGroups へ移して取り除く。
  groups?: OntologyGroup[]
  createdBy?: string
  createdAt: string
  updatedAt: string
}

// クラス／リレーションが持つ整理用フィールド。どちらも未設定を許容する。
//   groupId: 所属グループ。未設定／null＝「未分類」
//   order  : 同一グループ内の並び順。未設定は末尾（読み取り側で createdAt を副キーに安定ソート）。
//            値は 1000 刻みで振り、ドラッグ時は前後の中間値を1件だけ書き込む
//            （全件振り直しを避けるため）。隙間が尽きたときだけ振り直す。
export type OrganizableFields = {
  groupId?: string | null
  order?: number
}

export type OntologyClass = {
  id: string
  projectId: string
  name: string
  nameEn?: string
  // 同義語：文書中でこのクラスを指す別の呼び方（例：商品クラスの「製品」）。
  // オントロジー抽出・トリプレット抽出で LLM に渡し、読み替えに使う。
  synonyms?: string[]
  description: string
  parentId: string | null
  createdBy?: string
  updatedBy?: string
  createdAt: string
  updatedAt: string
  confirmations?: ConfirmationEvent[]
} & OrganizableFields

export type ClassPair = {
  sourceClassId: string
  targetClassId: string
}

// リレーション成立条件の演算子
//   比較（数値比較・等価判定）: eq/ne/gt/gte/lt/lte
//   範囲                     : between/notBetween（下限～上限、両端含む）
//   集合                     : in/notIn
export type RelationConditionOperator =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "notBetween"
  | "in"
  | "notIn"

// リレーション成立条件（1件＝1つの述語）。同一リレーションに紐づく複数条件は
// すべて満たされたとき（AND）に成立とみなす。
//   例）気温 ≥ 30℃／設置場所 = 屋外／長さ が 0.5〜0.8m の範囲内
export type RelationCondition = {
  // 対象データ名（自由記述）。例："気温", "設置場所", "長さ"
  variable: string
  // 単位（任意）。例："℃", "m", "kg"
  unit?: string
  operator: RelationConditionOperator
  // 比較演算(eq/ne/gt/gte/lt/lte)で用いる単一値
  value?: string
  // 範囲演算(between/notBetween)で用いる下限・上限（両端を含む）
  valueMin?: string
  valueMax?: string
  // 集合演算(in/notIn)で用いる値の集合
  values?: string[]
}

export type OntologyRelation = {
  id: string
  projectId: string
  name: string
  nameEn?: string
  description: string
  classPairs: ClassPair[]
  parentRelationId: string | null
  // 成立条件（AND評価）。未設定＝条件なし（常に成立）
  conditions?: RelationCondition[]
  createdBy?: string
  updatedBy?: string
  createdAt: string
  updatedAt: string
  confirmations?: ConfirmationEvent[]
} & OrganizableFields

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

// インスタンスのライフサイクル状態（名寄せ設計・登録／名寄せチェック分離モデル）
//   登録（本登録）はすべての経路で「即時」に行われる。仮登録という中間状態は廃止し、
//   代わりに「名寄せチェック済みか否か」を独立した軸として status で表す。
//   provisional 本登録済み・名寄せ未チェック: 全登録経路（手動追加/YAMLインポート/LLM候補採用）の着地点
//   confirmed   本登録済み・名寄せチェック済み: 名寄せチェックを通過済み。トリプレット作成で利用可
//   merged      統合済み: 名寄せで不採用となった側。物理削除せず保持し、既定で非表示
// 後方互換／移行: status 未設定の既存データは confirmed 相当（＝名寄せチェック済み）として扱う。
//   旧「本登録」= confirmed（＝チェック済み）、旧「仮登録」= provisional（＝本登録済み・未チェック）に
//   そのまま対応するため、データ移行は不要（恒等写像）。
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
  confirmations?: ConfirmationEvent[]
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

// ─────────────────────────────────────────────
// トリプレット（(主語インスタンス)—[述語リレーション]→(目的語インスタンス)）
//   トリプレット化できるのは本登録(confirmed)インスタンスのみ（名寄せ設計の原則）。
//   一覧・Neo4jエクスポートの対象は本登録トリプレットのみ。
// ─────────────────────────────────────────────

// 文書から抽出したトリプレットの候補。
// 【重要】抽出は必ず「登録済み（本登録）インスタンス」と「定義済みリレーション」を候補として
// LLMに渡し、その中から id を選ばせる（定義に無い事物は抽出させない）。したがって candidate は
// 表層文字列ではなく、選ばれた id を保持する。表層(subjectText等)は表示・監査用の参考値。
// フェーズ2（文書取込みビュー）で使用。判定（クラスペア整合など）は lib/triplet-resolve.ts の
// サーバ処理（LLM不要）で都度算出する。
export type TripletResolveStatus = "valid" | "type_conflict" | "unresolved"

export type TripletCandidate = {
  id: string
  projectId: string
  sourceDocName: string
  // LLM が登録済みインスタンス／定義済みリレーションの中から選んだ id
  subjectInstanceId: string
  predicateRelationId: string
  objectInstanceId: string
  // 抽出当時の表層（参考・表示フォールバック用）
  subjectText?: string
  predicateText?: string
  objectText?: string
  evidence: string // 抽出根拠スニペット
  confidence?: number
  createdBy: string
  createdAt: string
  // 直近の判定スナップショット（表示用・任意）。判定は都度サーバで再計算してよい
  resolvedStatus?: TripletResolveStatus
}

// 承認済み（本登録）トリプレット。一覧・エクスポートの対象。
export type Triplet = {
  id: string
  projectId: string
  subjectInstanceId: string
  predicateRelationId: string
  objectInstanceId: string
  // 表示・エクスポート安定用スナップショット（作成/承認当時の名前・クラス）
  subjectName: string
  subjectClassId: string | null
  predicateName: string
  objectName: string
  objectClassId: string | null
  sourceDocName?: string
  evidence?: string
  // このトリプレット（エッジ）固有の属性値。キーは述語リレーションに定義された
  // 属性の id（プロジェクト共通属性＋リレーション固有属性）。値は表示文字列。
  attributes?: Record<string, string>
  sourceCandidateId?: string // 由来の TripletCandidate（手動追加なら未設定）
  approvedBy: string
  approvedAt: string
  neo4jSynced?: boolean
  neo4jSyncedAt?: string
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
  confirmations?: ConfirmationEvent[]
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
