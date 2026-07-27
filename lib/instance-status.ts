import type { InstanceStatus, OntologyInstance } from "./types"
import { normalizeName } from "./normalize"

// status 未設定の既存インスタンスは confirmed（本登録相当）として扱う。
// 理由: フェーズ1導入以前に登録されたデータは旧「登録＝確定」モデルで
// 登録済みのため。新規登録は必ず provisional で着地する（API側で明示設定）。
export function instanceStatus(inst: Pick<OntologyInstance, "status">): InstanceStatus {
  return inst.status ?? "confirmed"
}

export function isMerged(inst: Pick<OntologyInstance, "status">): boolean {
  return instanceStatus(inst) === "merged"
}

export function isProvisional(inst: Pick<OntologyInstance, "status">): boolean {
  return instanceStatus(inst) === "provisional"
}

export function isConfirmed(inst: Pick<OntologyInstance, "status">): boolean {
  return instanceStatus(inst) === "confirmed"
}

// normalizedName が未設定の既存データは name から都度算出してフォールバック。
export function normalizedNameOf(inst: Pick<OntologyInstance, "name" | "normalizedName">): string {
  return inst.normalizedName ?? normalizeName(inst.name)
}
