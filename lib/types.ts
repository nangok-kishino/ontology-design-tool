// Cosmos DB エンティティ型定義

export type Project = {
  id: string
  name: string
  description: string
  createdAt: string
  updatedAt: string
}

export type OntologyClass = {
  id: string
  projectId: string
  name: string
  description: string
  parentId: string | null
  createdAt: string
  updatedAt: string
}

export type OntologyRelation = {
  id: string
  projectId: string
  name: string
  description: string
  sourceClassId: string
  targetClassId: string
  parentRelationId: string | null
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
  dataType: string
  required: AttributeRequired
  scope: AttributeScope
  targetId: string
  targetType: AttributeTargetType
  createdAt: string
  updatedAt: string
}

export type OntologyInstance = {
  id: string
  projectId: string
  name: string
  classId: string
  registeredBy: string
  registeredAt: string
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
