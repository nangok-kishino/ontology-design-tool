"use client"

// リレーションシップの追加ダイアログと、始点・終点を選ぶ部品。
// リレーションシップ管理とグラフデータ確認の両方から使う（どちらから足しても同じ手順になるように）。
//
// 入力の順番は、リレーションシップタイプ → 始点ノード(A) → 終点ノード(B)。
// 「このタイプの関係を登録したい」とタイプから考えるのが、スキーマが先のこのアプリの使い方のため。
// ラベルペアのみを表示する指定のときは、選んだタイプのラベルペアで始点・終点の候補を絞る。

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label as FieldLabel } from "@/components/ui/label"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { LabelChip, LabelChips } from "@/components/label-chip"
import { nextOrder } from "@/lib/organize"
import { normalizeName } from "@/lib/normalize"
import type { GraphNode, Relationship, RelationshipType } from "@/lib/graph-types"
import { Loader2, Search, X } from "lucide-react"

// ノードを名前で絞り込んで選ぶ欄。件数が多いので素の Select では探しにくい。
export function NodePicker({
  nodes,
  labelName,
  value,
  onChange,
  placeholder,
  doneIds,
  allNodes,
}: {
  nodes: GraphNode[]
  labelName: (id: string) => string
  value: string
  onChange: (id: string) => void
  placeholder: string
  // 今の入力のままこのノードを選ぶと、登録済みの組み合わせになるノード（連続登録で片方だけ変えるときの目印）
  doneIds?: Set<string>
  // 選んであるノードを探す範囲。候補（nodes）に入らないノードが選んである場合でも表示できるように
  allNodes?: GraphNode[]
}) {
  const [query, setQuery] = useState("")
  const selected = (allNodes ?? nodes).find((n) => n.id === value) ?? null
  const shown = useMemo(() => {
    const q = normalizeName(query)
    return nodes.filter((n) => !q || normalizeName(n.name).includes(q)).slice(0, 60)
  }, [nodes, query])

  if (selected) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-input px-2.5 py-1.5">
        <span className="min-w-0 flex-1 space-y-1">
          <LabelChips names={(selected.labelIds ?? []).map(labelName)} />
          <span className="block truncate text-sm text-foreground">{selected.name}</span>
        </span>
        <button type="button" aria-label="選び直す"
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted"
          onClick={() => { onChange(""); setQuery("") }}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }
  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder} className="h-8 pl-7" />
      </div>
      <div className="max-h-44 overflow-y-auto rounded-lg border border-border">
        {shown.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted-foreground">該当するノードがありません</p>
        ) : shown.map((n) => (
          <button key={n.id} type="button"
            className="flex w-full flex-col items-start gap-1 px-2.5 py-1.5 text-left transition-colors hover:bg-muted"
            onClick={() => onChange(n.id)}>
            <LabelChips names={(n.labelIds ?? []).map(labelName)} />
            <span className="flex w-full items-center gap-2 text-sm text-foreground">
              <span className="min-w-0 flex-1 truncate">{n.name}</span>
              {doneIds?.has(n.id) && <span className="shrink-0 text-xs text-muted-foreground">登録済み</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

// 始点・終点の候補。ラベルペアのみを表示する指定のときは、タイプのラベルペアで絞る。
// 終点は、選んだ始点のラベルから許される終点ラベルを持つノードだけにする。
export function useEndChoices(
  nodes: GraphNode[],
  type: RelationshipType | null,
  start: GraphNode | null,
  restrictToSchema: boolean,
) {
  const liveNodes = useMemo(() => nodes.filter((n) => n.status !== "merged"), [nodes])
  const startChoices = useMemo(() => {
    if (!restrictToSchema || !type) return liveNodes
    const allowed = new Set((type.labelPairs ?? []).map((p) => p.sourceLabelId))
    return liveNodes.filter((n) => (n.labelIds ?? []).some((id) => allowed.has(id)))
  }, [liveNodes, restrictToSchema, type])
  const endChoices = useMemo(() => {
    if (!restrictToSchema || !type || !start) return liveNodes
    const allowed = new Set(
      (type.labelPairs ?? [])
        .filter((p) => (start.labelIds ?? []).includes(p.sourceLabelId))
        .map((p) => p.targetLabelId),
    )
    return liveNodes.filter((n) => (n.labelIds ?? []).some((id) => allowed.has(id)))
  }, [liveNodes, restrictToSchema, type, start])
  return { startChoices, endChoices }
}

export function RelationshipAddDialog({
  open,
  onOpenChange,
  projectId,
  relationships,
  nodes,
  orderedTypes,
  labelName,
  initialTypeId,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string | undefined
  relationships: Relationship[]
  nodes: GraphNode[]
  // タイプの選択肢。リレーションシップタイプ管理と同じ並びで渡す
  orderedTypes: RelationshipType[]
  labelName: (id: string) => string
  // 開いたときに選んでおくタイプ（グラフデータ確認で見ているタイプなど）
  initialTypeId?: string
  // keepOpen: ［追加して続ける］で足したとき（ダイアログは開いたまま）
  onCreated: (created: Relationship, keepOpen: boolean) => void
}) {
  const [newStartId, setNewStartId] = useState("")
  const [newTypeId, setNewTypeId] = useState("")
  const [newEndId, setNewEndId] = useState("")
  const [restrictToSchema, setRestrictToSchema] = useState(true)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  // 連続追加で、このダイアログを開いてから登録したもの（作業の控え）
  const [addedLabels, setAddedLabels] = useState<string[]>([])

  useEffect(() => {
    if (!open) return
    setNewStartId(""); setNewTypeId(initialTypeId ?? ""); setNewEndId("")
    setRestrictToSchema(true); setAddError(null); setAddedLabels([])
  }, [open, initialTypeId])

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const newType = orderedTypes.find((t) => t.id === newTypeId) ?? null
  const newStart = newStartId ? nodeById.get(newStartId) ?? null : null
  const { startChoices, endChoices } = useEndChoices(nodes, newType, newStart, restrictToSchema)

  // 選んだタイプ・始点で既に繋いである終点と、選んだタイプ・終点で既に繋いである始点。
  // 同じ組み合わせはサーバーでも 409 で止まるが、選ぶ前に分かるようにする
  const linkedEndIds = useMemo(() => new Set(
    relationships
      .filter((r) => r.relTypeId === newTypeId && r.startNodeId === newStartId)
      .map((r) => r.endNodeId),
  ), [relationships, newTypeId, newStartId])
  const linkedStartIds = useMemo(() => new Set(
    newEndId
      ? relationships
        .filter((r) => r.relTypeId === newTypeId && r.endNodeId === newEndId)
        .map((r) => r.startNodeId)
      : [],
  ), [relationships, newTypeId, newEndId])
  const duplicate = !!newEndId && linkedEndIds.has(newEndId)

  // 始点を選び直しても終点は残す（始点だけ変えて続けて登録するため）。
  // ただしラベルペアで絞っているときに、新しい始点では許されない終点になったら外す
  useEffect(() => {
    if (restrictToSchema && newStartId && newEndId && !endChoices.some((n) => n.id === newEndId)) setNewEndId("")
  }, [restrictToSchema, newStartId, newEndId, endChoices])

  // keepOpen: ダイアログを閉じず、入力をそのまま残して次を受け付ける（始点か終点の片方だけ変えて続けて登録する使い方）
  const handleAdd = async (keepOpen: boolean) => {
    if (!projectId || !newStartId || !newTypeId || !newEndId) return
    setAdding(true); setAddError(null)
    try {
      const res = await fetch("/api/relationships", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          startNodeId: newStartId, relTypeId: newTypeId, endNodeId: newEndId,
          order: nextOrder(relationships),
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setAddError(err.error ?? "作成に失敗しました")
        return
      }
      const created: Relationship = await res.json()
      if (keepOpen) {
        setAddedLabels((prev) => [...prev, `${created.startNodeName} → ${created.relTypeName} → ${created.endNodeName}`])
      } else {
        onOpenChange(false)
      }
      onCreated(created, keepOpen)
    } finally {
      setAdding(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>リレーションシップを追加</DialogTitle></DialogHeader>
        <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={restrictToSchema}
              onChange={(e) => { setRestrictToSchema(e.target.checked); setNewStartId(""); setNewEndId("") }} />
            スキーマ設計で定義されたラベルペアのみを表示する
          </label>
          <div className="space-y-1.5">
            <FieldLabel className="text-sm font-medium">
              リレーションシップタイプ <span className="text-destructive">*</span>
            </FieldLabel>
            <Select value={newTypeId}
              onValueChange={(v) => { if (v) { setNewTypeId(v); setNewStartId(""); setNewEndId("") } }}>
              <SelectTrigger className="h-8">
                <SelectValue>{newType?.name ?? "選択してください"}</SelectValue>
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {orderedTypes.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {newType && (newType.labelPairs ?? []).length > 0 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                ラベルペア：
                {(newType.labelPairs ?? []).map((p, i) => (
                  <span key={i} className="inline-flex items-center gap-1">
                    <LabelChip name={labelName(p.sourceLabelId)} />→<LabelChip name={labelName(p.targetLabelId)} />
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <FieldLabel className="text-sm font-medium">
              始点ノード(A) <span className="text-destructive">*</span>
            </FieldLabel>
            {!newTypeId ? (
              <p className="text-xs text-muted-foreground">先にリレーションシップタイプを選んでください</p>
            ) : (
              <>
                <NodePicker nodes={startChoices} labelName={labelName} value={newStartId}
                  onChange={(id) => { setNewStartId(id); setAddError(null) }}
                  placeholder="始点にするノードを探す" doneIds={linkedStartIds} />
                {restrictToSchema && startChoices.length === 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-500">
                    このタイプのラベルペアの始点ラベルを持つノードがありません。
                  </p>
                )}
              </>
            )}
          </div>
          <div className="space-y-1.5">
            <FieldLabel className="text-sm font-medium">
              終点ノード(B) <span className="text-destructive">*</span>
            </FieldLabel>
            {!newStartId ? (
              <p className="text-xs text-muted-foreground">先に始点ノード(A)を選んでください</p>
            ) : (
              <>
                <NodePicker nodes={endChoices} labelName={labelName} value={newEndId}
                  onChange={(id) => { setNewEndId(id); setAddError(null) }} placeholder="終点にするノードを探す"
                  doneIds={linkedEndIds} />
                {restrictToSchema && endChoices.length === 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-500">
                    このタイプのラベルペアの終点ラベルを持つノードがありません。
                  </p>
                )}
              </>
            )}
          </div>
          {duplicate && (
            <p className="text-xs text-amber-600 dark:text-amber-500">この組み合わせは登録済みです。始点ノード(A)か終点ノード(B)を選び直してください。</p>
          )}
          {addError && <p className="text-xs text-destructive">{addError}</p>}
          {addedLabels.length > 0 && (
            <p className="text-xs text-muted-foreground">
              追加済み（{addedLabels.length}件）：{addedLabels.join("、")}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            ［追加して続ける］は入力をそのまま残します。始点ノード(A)・終点ノード(B)のうち変えたいほうだけ選び直せば、次のリレーションシップを続けて登録できます。
            プロパティ値と成立条件は、追加したあとリレーションシップ管理の詳細パネルで入力します。
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>閉じる</Button>
          <Button variant="outline" onClick={() => handleAdd(true)}
            disabled={adding || !newStartId || !newTypeId || !newEndId || duplicate}>
            {adding && <Loader2 className="h-3.5 w-3.5 animate-spin" />}追加して続ける
          </Button>
          <Button onClick={() => handleAdd(false)}
            disabled={adding || !newStartId || !newTypeId || !newEndId || duplicate}>
            {adding && <Loader2 className="h-3.5 w-3.5 animate-spin" />}追加
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
