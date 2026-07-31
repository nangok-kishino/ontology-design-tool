import type { InstanceStatus, OntologyInstance } from "./types"
import { normalizeName } from "./normalize"

// status 未設定の既存インスタンスは confirmed（＝名寄せチェック済み）として扱う。
// 理由: 名寄せチェック分離モデル導入以前のデータは旧「本登録」相当のため、
// チェック済みに寄せる（移行は恒等写像）。新規登録は必ず provisional
//（＝本登録済み・名寄せ未チェック）で着地する（API側で明示設定）。
export function instanceStatus(inst: Pick<OntologyInstance, "status">): InstanceStatus {
  return inst.status ?? "confirmed"
}

export function isMerged(inst: Pick<OntologyInstance, "status">): boolean {
  return instanceStatus(inst) === "merged"
}

// provisional = 本登録済みだが名寄せ未チェック（登録自体は完了している）。
export function isProvisional(inst: Pick<OntologyInstance, "status">): boolean {
  return instanceStatus(inst) === "provisional"
}

export function isConfirmed(inst: Pick<OntologyInstance, "status">): boolean {
  return instanceStatus(inst) === "confirmed"
}

// 名寄せチェック済みか（＝ confirmed）。トリプレット作成の可否ゲートに使う
// 意味を明示するための別名。統合済み(merged)は当然チェック対象外＝false。
export function isNameChecked(inst: Pick<OntologyInstance, "status">): boolean {
  return instanceStatus(inst) === "confirmed"
}

// 本登録済みか（統合済み以外はすべて本登録済み）。名寄せチェックの有無は問わない。
export function isRegistered(inst: Pick<OntologyInstance, "status">): boolean {
  return instanceStatus(inst) !== "merged"
}

// normalizedName が未設定の既存データは name から都度算出してフォールバック。
export function normalizedNameOf(inst: Pick<OntologyInstance, "name" | "normalizedName">): string {
  return inst.normalizedName ?? normalizeName(inst.name)
}
