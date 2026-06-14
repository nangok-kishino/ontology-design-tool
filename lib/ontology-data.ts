// オントロジー設計のサンプルデータ

export type ClassNode = {
  id: string
  name: string
  description: string
  parentId: string | null
  children?: ClassNode[]
}

export type Attribute = {
  id: string
  name: string
  dataType: string
  required: "必須" | "任意"
  scope: "共通" | "固有"
}

export type Relation = {
  id: string
  name: string
  sourceClass: string
  targetClass: string
  description: string
}

export type RelationAttribute = {
  id: string
  name: string
  dataType: string
  required: "必須" | "任意"
}

export type Constraint = {
  id: string
  type: "クラス階層" | "リレーション始点・終点"
  content: string
  target: string
}

export type CandidateStatus = "確認中" | "承認済み" | "却下"

export type ClassCandidate = {
  id: string
  name: string
  description: string
  status: CandidateStatus
}

export type RelationCandidate = {
  id: string
  source: string
  name: string
  target: string
  description: string
  status: CandidateStatus
}

// クラス階層
export const classTree: ClassNode[] = [
  {
    id: "chiken",
    name: "知見",
    description: "製造現場で蓄積された経験的・技術的な知識の総称。",
    parentId: null,
    children: [
      {
        id: "fuguai",
        name: "不具合事例",
        description: "過去に発生した製品・工程の不具合に関する記録。",
        parentId: "chiken",
      },
      {
        id: "taisaku",
        name: "対策",
        description: "不具合の再発防止や品質改善のために講じる施策。",
        parentId: "chiken",
      },
    ],
  },
  {
    id: "kousei",
    name: "構成要素",
    description: "製品を構成する物理的・機能的な要素。",
    parentId: null,
    children: [
      {
        id: "buhin",
        name: "部品",
        description: "製品を構成する個々の機械・電子部品。",
        parentId: "kousei",
      },
      {
        id: "zairyo",
        name: "材料",
        description: "部品や製品の製造に使用される素材。",
        parentId: "kousei",
      },
    ],
  },
]

export const classDescriptions: Record<string, { name: string; description: string; parent: string }> = {
  chiken: { name: "知見", description: "製造現場で蓄積された経験的・技術的な知識の総称。", parent: "（なし）" },
  fuguai: {
    name: "不具合事例",
    description: "過去に発生した製品・工程の不具合に関する記録。発生条件、原因、影響範囲を含む。",
    parent: "知見",
  },
  taisaku: { name: "対策", description: "不具合の再発防止や品質改善のために講じる施策。", parent: "知見" },
  kousei: { name: "構成要素", description: "製品を構成する物理的・機能的な要素。", parent: "（なし）" },
  buhin: { name: "部品", description: "製品を構成する個々の機械・電子部品。", parent: "構成要素" },
  zairyo: { name: "材料", description: "部品や製品の製造に使用される素材。", parent: "構成要素" },
}

export const sampleAttributes: Attribute[] = [
  { id: "a1", name: "登録日", dataType: "日時", required: "必須", scope: "共通" },
  { id: "a2", name: "出典", dataType: "文字列", required: "任意", scope: "共通" },
  { id: "a3", name: "発生工程", dataType: "文字列", required: "必須", scope: "固有" },
  { id: "a4", name: "影響度", dataType: "数値", required: "任意", scope: "固有" },
]

export const relations: Relation[] = [
  {
    id: "r1",
    name: "原因は",
    sourceClass: "不具合事例",
    targetClass: "構成要素",
    description: "不具合事例の根本原因となった構成要素を関連付ける。",
  },
  {
    id: "r2",
    name: "対策は",
    sourceClass: "不具合事例",
    targetClass: "対策",
    description: "不具合事例に対して実施した対策を関連付ける。",
  },
  {
    id: "r3",
    name: "使用材料は",
    sourceClass: "部品",
    targetClass: "材料",
    description: "部品の製造に使用された材料を関連付ける。",
  },
]

export const relationAttributes: RelationAttribute[] = [
  { id: "ra1", name: "適用条件", dataType: "文字列", required: "任意" },
  { id: "ra2", name: "確信度", dataType: "数値", required: "任意" },
  { id: "ra3", name: "確認日", dataType: "日時", required: "任意" },
]

export const constraints: Constraint[] = [
  {
    id: "c1",
    type: "クラス階層",
    content: "「不具合事例」は「知見」のサブクラスである",
    target: "不具合事例 / 知見",
  },
  {
    id: "c2",
    type: "リレーション始点・終点",
    content: "「原因は」の始点は「不具合事例」、終点は「構成要素」に限定される",
    target: "原因は",
  },
  {
    id: "c3",
    type: "リレーション始点・終点",
    content: "「使用材料は」の始点は「部品」、終点は「材料」に限定される",
    target: "使用材料は",
  },
]

export const classCandidates: ClassCandidate[] = [
  { id: "cc1", name: "熱膨張現象", description: "温度変化に伴う部材の寸法変化に関する物理現象。", status: "確認中" },
  { id: "cc2", name: "表面処理工程", description: "部品表面に施すめっき・塗装などの加工工程。", status: "確認中" },
  { id: "cc3", name: "検査基準値", description: "品質検査における合否判定の基準となる数値範囲。", status: "確認中" },
  { id: "cc4", name: "設計変更履歴", description: "製品設計の変更内容と適用時期の記録。", status: "確認中" },
  { id: "cc5", name: "材料特性データ", description: "材料の機械的・熱的特性を記述したデータ。", status: "確認中" },
]

export const relationCandidates: RelationCandidate[] = [
  {
    id: "rc1",
    source: "不具合事例",
    name: "発生条件は",
    target: "熱膨張現象",
    description: "不具合の発生条件となる現象を関連付ける。",
    status: "確認中",
  },
  {
    id: "rc2",
    source: "対策",
    name: "適用工程は",
    target: "表面処理工程",
    description: "対策を適用する製造工程を関連付ける。",
    status: "確認中",
  },
  {
    id: "rc3",
    source: "部品",
    name: "検査項目は",
    target: "検査基準値",
    description: "部品の検査に用いる基準値を関連付ける。",
    status: "確認中",
  },
]

// 親クラス候補（ドロップダウン用）
export const parentClassOptions = ["知見", "不具合事例", "対策", "構成要素", "部品", "材料"]

// ダッシュボード：クラスとインスタンスの対応
export const classInstanceRows: { className: string; parentClassName: string | null; instances: string[] }[] = [
  { className: "知見", parentClassName: null, instances: ["ポンプ異音事案2023", "モーター過熱事案2024"] },
  { className: "不具合事例", parentClassName: "知見", instances: ["ポンプ異音事案2023"] },
  { className: "対策", parentClassName: "知見", instances: ["潤滑油の交換周期短縮", "冷却ファンの増設"] },
  { className: "構成要素", parentClassName: null, instances: ["部品Bの熱膨張", "冷却経路の詰まり"] },
  { className: "部品", parentClassName: "構成要素", instances: [] },
  { className: "材料", parentClassName: "構成要素", instances: [] },
]

// ダッシュボード：リレーション一覧
export const dashboardRelationRows: { name: string; flow: string }[] = [
  { name: "原因は", flow: "不具合事例 → 構成要素" },
  { name: "対策は", flow: "不具合事例 → 対策" },
]

// クラス用インスタンス管理
export type Instance = {
  id: string
  name: string
  registeredAt: string
  registeredBy: string
}

export const instancesByClass: Record<string, Instance[]> = {
  知見: [
    { id: "i1", name: "ポンプ異音事案2023", registeredAt: "2023-11-12", registeredBy: "山田 太郎" },
    { id: "i2", name: "モーター過熱事案2024", registeredAt: "2024-03-05", registeredBy: "佐藤 花子" },
    { id: "i3", name: "配管腐食事案2024", registeredAt: "2024-07-21", registeredBy: "鈴木 一郎" },
  ],
  不具合事例: [
    { id: "i4", name: "ポンプ異音事案2023", registeredAt: "2023-11-12", registeredBy: "山田 太郎" },
    { id: "i5", name: "軸受摩耗事案2023", registeredAt: "2023-09-30", registeredBy: "高橋 健" },
  ],
  構成要素: [
    { id: "i6", name: "部品Bの熱膨張", registeredAt: "2024-01-18", registeredBy: "田中 美咲" },
    { id: "i7", name: "冷却経路の詰まり", registeredAt: "2024-02-22", registeredBy: "伊藤 大輔" },
    { id: "i8", name: "シール材の劣化", registeredAt: "2024-05-10", registeredBy: "渡辺 由美" },
  ],
  対策: [
    { id: "i9", name: "潤滑油の交換周期短縮", registeredAt: "2024-04-02", registeredBy: "佐藤 花子" },
    { id: "i10", name: "冷却ファンの増設", registeredAt: "2024-06-14", registeredBy: "山田 太郎" },
  ],
}

export const instanceClassList = ["知見", "不具合事例", "構成要素", "対策"]
