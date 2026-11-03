"use client"

// リレーションシップ1件の詳細パネル（基本情報・始点と終点の変更・根拠・成立条件・プロパティ・削除）。
// リレーションシップ管理とグラフデータ確認の両方の右ペインで使う（どちらで直しても同じ手順になるように）。

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Label as FieldLabel } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SectionHeader } from "@/components/section-header"
import { ConfirmationSummary } from "@/components/confirmation-summary"
import { ConditionValueList, hasIncompleteConditions } from "@/components/condition-fields"
import { PropertyValueList } from "@/components/property-section"
import { LabelChips } from "@/components/label-chip"
import { NodePicker, useEndChoices } from "@/components/relationship-add-dialog"
import { cn } from "@/lib/utils"
import { conditionSetsOf, relTypeAllows } from "@/lib/graph-types"
import type {
  GraphNode, PropertyDef, Relationship, RelationshipConditions, RelationshipType,
} from "@/lib/graph-types"
import { AlertTriangle, ArrowRight, FileText, Filter, Loader2, Pencil, Plus, Tags, Trash2 } from "lucide-react"

const REL_FIELD_LABEL: Record<string, string> = {
  startNode: "始点ノード",
  endNode: "終点ノード",
  properties: "プロパティ",
  conditions: "成立条件",
  evidence: "根拠",
}

function formatDateTime(iso: string | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("ja-JP", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  })
}

export function RelationshipDetailPanel({
  relationship: selected,
  relationships,
  nodes,
  relTypes,
  propertyDefs,
  labelName,
  onUpdated,
  onDeleted,
  header,
  className,
}: {
  relationship: Relationship
  // 始点・終点を変えたときの重複チェックに使う
  relationships: Relationship[]
  nodes: GraphNode[]
  relTypes: RelationshipType[]
  propertyDefs: PropertyDef[]
  labelName: (id: string) => string
  onUpdated: (updated: Relationship) => void
  onDeleted: (id: string) => void
  // パネルの上に置くもの（グラフデータ確認の、束の中から1件を選ぶ欄と閉じるボタンなど）
  header?: React.ReactNode
  className?: string
}) {
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const selectedType = relTypes.find((t) => t.id === selected.relTypeId) ?? null

  // 詳細
  const [editValues, setEditValues] = useState<Record<string, string>>({})
  // 成立条件（条件セットの並び。セットの中は「かつ」、セット同士は「または」）
  const [editConditionSets, setEditConditionSets] = useState<RelationshipConditions[]>([])
  const [editEvidence, setEditEvidence] = useState("")
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // 始点・終点の変更（タイプは変えられない。成立条件・プロパティがタイプごとの定義のため）
  const [showEnds, setShowEnds] = useState(false)
  const [endsStartId, setEndsStartId] = useState("")
  const [endsEndId, setEndsEndId] = useState("")
  const [endsRestrict, setEndsRestrict] = useState(true)
  const [endsSaving, setEndsSaving] = useState(false)
  const [endsError, setEndsError] = useState<string | null>(null)

  useEffect(() => {
    setEditValues(selected.properties ?? {})
    setEditConditionSets(conditionSetsOf(selected))
    setEditEvidence(selected.evidence ?? "")
    setSaveError(null)
  }, [selected.id])

  // ─── スキーマ整合（ラベルペアに合っているか） ───
  // 端のノードが残っていれば今のラベルで、消えていれば作成時のスナップショットで見る。
  const labelsOf = useCallback(
    (nodeId: string, snapshot: string[] | undefined) => nodeById.get(nodeId)?.labelIds ?? snapshot ?? [],
    [nodeById],
  )
  const matchesSchema = !!selectedType && relTypeAllows(
    selectedType,
    labelsOf(selected.startNodeId, selected.startNodeLabelIds),
    labelsOf(selected.endNodeId, selected.endNodeLabelIds),
  )

  // ─── このリレーションシップが持てるプロパティ ───
  const applicableProps = useMemo(() => {
    const picked = new Map<string, PropertyDef>()
    for (const p of propertyDefs) {
      const belongs =
        p.targetType === "project" ||
        (p.targetType === "relationshipType" && p.targetId === selected.relTypeId)
      if (!belongs) continue
      if (!picked.has(p.name)) picked.set(p.name, p)
    }
    return [...picked.values()].sort((a, b) => a.name.localeCompare(b.name, "ja"))
  }, [propertyDefs, selected.relTypeId])

  // ─── 始点・終点の変更 ───
  const endsStart = endsStartId ? nodeById.get(endsStartId) ?? null : null
  const { startChoices: endsStartChoices, endChoices: endsEndChoices } =
    useEndChoices(nodes, selectedType, endsStart, endsRestrict)
  const endsChanged = endsStartId !== selected.startNodeId || endsEndId !== selected.endNodeId
  const endsDuplicate = relationships.some((r) =>
    r.id !== selected.id && r.relTypeId === selected.relTypeId &&
    r.startNodeId === endsStartId && r.endNodeId === endsEndId)

  const openEndsDialog = () => {
    setEndsStartId(selected.startNodeId); setEndsEndId(selected.endNodeId)
    // 今の組み合わせがスキーマに無いものなら、絞り込まずに開く（今の端が候補から消えないように）
    setEndsRestrict(matchesSchema); setEndsError(null); setShowEnds(true)
  }

  const handleSaveEnds = async () => {
    if (!endsStartId || !endsEndId) return
    setEndsSaving(true); setEndsError(null)
    try {
      const res = await fetch(`/api/relationships/${selected.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startNodeId: endsStartId, endNodeId: endsEndId }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setEndsError(err.error ?? "変更に失敗しました")
        return
      }
      onUpdated(await res.json())
      setShowEnds(false)
    } finally {
      setEndsSaving(false)
    }
  }

  // ─── 保存・削除 ───
  const dirty =
    JSON.stringify(editValues) !== JSON.stringify(selected.properties ?? {}) ||
    JSON.stringify(editConditionSets) !== JSON.stringify(conditionSetsOf(selected)) ||
    editEvidence !== (selected.evidence ?? "")

  const handleSave = async () => {
    setSaving(true); setSaveError(null)
    try {
      const allowed = new Set(applicableProps.map((p) => p.name))
      const values = Object.fromEntries(
        Object.entries(editValues).filter(([k, v]) => allowed.has(k) && v !== ""),
      )
      const res = await fetch(`/api/relationships/${selected.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ properties: values, conditionSets: editConditionSets, evidence: editEvidence }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setSaveError(err.error ?? "保存に失敗しました")
        return
      }
      onUpdated(await res.json())
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      const res = await fetch(`/api/relationships/${selected.id}`, { method: "DELETE" })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setSaveError(err.error ?? "削除に失敗しました")
        setShowDelete(false)
        return
      }
      setShowDelete(false)
      onDeleted(selected.id)
    } finally {
      setDeleting(false)
    }
  }

  // 端ノードが持っているプロパティ値。値が入っているものだけを名前順で。
  const nodePropertyEntries = (nodeId: string): [string, string][] =>
    Object.entries(nodeById.get(nodeId)?.properties ?? {})
      .filter(([, v]) => v !== "")
      .sort((a, b) => a[0].localeCompare(b[0], "ja"))

  // 端ノード1つ分の表示（ラベル → 名前 → プロパティ）
  const renderEndNode = (
    caption: string,
    nodeId: string,
    name: string,
    labelSnapshot: string[] | undefined,
  ) => {
    const entries = nodePropertyEntries(nodeId)
    return (
      <div>
        <span className="mb-1 block text-xs text-muted-foreground">{caption}</span>
        <LabelChips names={labelsOf(nodeId, labelSnapshot).map(labelName)} />
        <span className="mt-1 block font-medium text-foreground">{name}</span>
        {entries.length > 0 && (
          <dl className="mt-1 space-y-0.5">
            {entries.map(([key, value]) => (
              <div key={key} className="flex gap-2 text-xs">
                <dt className="shrink-0 text-muted-foreground">{key}</dt>
                <dd className="min-w-0 flex-1 truncate text-foreground" title={value}>{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    )
  }

  return (
    <div className={cn("flex w-[30rem] shrink-0 flex-col overflow-hidden bg-card", className)}>
      {header}
      <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
        <section className="space-y-3">
          <SectionHeader icon={FileText} title="基本情報" />
          <div className="space-y-3">
            <div className="space-y-1 text-xs text-muted-foreground">
              <ConfirmationSummary events={selected.confirmations} fieldLabels={REL_FIELD_LABEL} />
              <p>作成日 {formatDateTime(selected.createdAt)}{selected.createdBy ? `（${selected.createdBy}）` : ""}</p>
              <p>更新日 {formatDateTime(selected.updatedAt)}{selected.updatedBy ? `（${selected.updatedBy}）` : ""}</p>
            </div>

            {/* 始点・終点は［変更］で付け替えられる。タイプは変えられない（変えたいときは作り直す） */}
            <div className="relative space-y-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm">
              <Button size="sm" variant="outline" className="absolute right-2 top-2 h-7 gap-1.5 bg-background"
                onClick={openEndsDialog}>
                <Pencil className="h-3.5 w-3.5" />始点・終点を変更
              </Button>
              {renderEndNode("始点ノード(A)", selected.startNodeId, selected.startNodeName, selected.startNodeLabelIds)}
              <div className="flex items-center gap-1.5 text-foreground">
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                {selected.relTypeName}
              </div>
              {renderEndNode("終点ノード(B)", selected.endNodeId, selected.endNodeName, selected.endNodeLabelIds)}
            </div>
            {!matchesSchema && (
              <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                このラベルの組み合わせは「{selected.relTypeName}」のラベルペアに定義されていません。
                ノードに上位ラベルを足すか、タイプ側にペアを足してください。
              </p>
            )}
            {selected.sourceDocName && (
              <p className="text-xs text-muted-foreground">出典 {selected.sourceDocName}</p>
            )}
            <div className="space-y-1.5">
              <FieldLabel className="text-sm font-medium">根拠</FieldLabel>
              <Textarea rows={3} value={editEvidence} onChange={(e) => setEditEvidence(e.target.value)}
                placeholder="文書中の根拠となる記述など" />
            </div>
            {saveError && <p className="text-xs text-destructive">{saveError}</p>}
          </div>
        </section>

        <section className="space-y-3">
          <SectionHeader icon={Filter} title="成立条件" />
          {(selectedType?.conditions ?? []).length === 0 ? (
            <p className="rounded-lg border border-dashed border-border py-3 text-center text-xs text-muted-foreground">
              「{selected.relTypeName}」に条件項目が定義されていません（常に成立）
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] text-muted-foreground">
                セットの中で印を付けた条件を<strong className="font-medium text-foreground">すべて満たし</strong>、
                かつ<strong className="font-medium text-foreground">どれか1つのセット</strong>を満たせば成立します。
                条件セットが無ければ常に成立します。
              </p>
              {editConditionSets.map((set, i) => (
                <div key={i} className="space-y-2">
                  {i > 0 && <p className="text-center text-xs font-medium text-muted-foreground">または</p>}
                  <div className="space-y-2 rounded-lg border border-border p-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">条件セット{i + 1}</span>
                      <button type="button"
                        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                        onClick={() => setEditConditionSets((prev) => prev.filter((_, j) => j !== i))}>
                        <Trash2 className="h-3 w-3" />セットを削除
                      </button>
                    </div>
                    <ConditionValueList hideHint
                      slots={selectedType?.conditions ?? []}
                      values={set}
                      onChange={(next) => setEditConditionSets((prev) => prev.map((x, j) => (j === i ? next : x)))}
                    />
                  </div>
                </div>
              ))}
              <Button size="sm" variant="outline" className="h-7 gap-1.5 bg-transparent"
                onClick={() => setEditConditionSets((prev) => [...prev, {}])}>
                <Plus className="h-3.5 w-3.5" />条件セットを追加
              </Button>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <SectionHeader icon={Tags} title="プロパティ" />
          {applicableProps.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border py-3 text-center text-xs text-muted-foreground">
              このタイプにプロパティが定義されていません
            </p>
          ) : (
            <PropertyValueList
              properties={applicableProps}
              values={editValues}
              onChange={(name, v) => setEditValues((prev) => ({ ...prev, [name]: v }))}
            />
          )}
          <p className="text-xs text-muted-foreground">
            定義の追加・編集はリレーションシップタイプ管理で行います。
          </p>
        </section>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-destructive"
          onClick={() => setShowDelete(true)}>
          <Trash2 className="h-3.5 w-3.5" />削除
        </Button>
        <Button size="sm" className="gap-1.5" onClick={handleSave}
          disabled={!dirty || saving || editConditionSets.some((set) => hasIncompleteConditions(selectedType?.conditions, set))}>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}保存
        </Button>
      </div>

      {/* 始点・終点の変更 */}
      <Dialog open={showEnds} onOpenChange={setShowEnds}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>始点・終点を変更</DialogTitle></DialogHeader>
          <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={endsRestrict} onChange={(e) => setEndsRestrict(e.target.checked)} />
              スキーマ設計で定義されたラベルペアのみを表示する
            </label>
            <div className="space-y-1.5">
              <FieldLabel className="text-sm font-medium">リレーションシップタイプ</FieldLabel>
              <p className="text-sm text-foreground">{selected.relTypeName}</p>
              <p className="text-xs text-muted-foreground">
                タイプは変えられません（成立条件・プロパティがタイプごとの定義のため）。変えたいときは作り直してください。
              </p>
            </div>
            <div className="space-y-1.5">
              <FieldLabel className="text-sm font-medium">
                始点ノード(A) <span className="text-destructive">*</span>
              </FieldLabel>
              <NodePicker nodes={endsStartChoices} allNodes={nodes} labelName={labelName} value={endsStartId}
                onChange={(id) => { setEndsStartId(id); setEndsError(null) }} placeholder="始点にするノードを探す" />
            </div>
            <div className="space-y-1.5">
              <FieldLabel className="text-sm font-medium">
                終点ノード(B) <span className="text-destructive">*</span>
              </FieldLabel>
              {!endsStartId ? (
                <p className="text-xs text-muted-foreground">先に始点ノード(A)を選んでください</p>
              ) : (
                <NodePicker nodes={endsEndChoices} allNodes={nodes} labelName={labelName} value={endsEndId}
                  onChange={(id) => { setEndsEndId(id); setEndsError(null) }} placeholder="終点にするノードを探す" />
              )}
            </div>
            {endsDuplicate && (
              <p className="text-xs text-amber-600 dark:text-amber-500">この組み合わせは登録済みです。</p>
            )}
            {endsError && <p className="text-xs text-destructive">{endsError}</p>}
            <p className="text-xs text-muted-foreground">
              根拠・成立条件・プロパティはそのまま引き継ぎます。確認済みのものは、組み合わせが変わるので未確認に戻ります。
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEnds(false)} disabled={endsSaving}>キャンセル</Button>
            <Button onClick={handleSaveEnds}
              disabled={endsSaving || !endsStartId || !endsEndId || !endsChanged || endsDuplicate}>
              {endsSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}変更
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 削除確認 */}
      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>リレーションシップを削除</DialogTitle></DialogHeader>
          <p className="text-sm">
            「{selected.startNodeName} → {selected.relTypeName} → {selected.endNodeName}」を削除します。
            この操作は取り消せません。
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)} disabled={deleting}>キャンセル</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}削除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
