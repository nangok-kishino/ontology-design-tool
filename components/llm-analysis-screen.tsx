"use client"

// LLMによる解析（AI活用）。文書を LLM に読ませ、スキーマ（ラベル・リレーションシップタイプ）と
// グラフデータ（ノード・リレーションシップ）の候補を出す。
//
// 候補は行ごとにアクションを1つ選び（最初は「見送り」）、タブ下の「○○のアクションを実行」でまとめて反映する。
// 押した瞬間に登録はしない。見送りのままの行は実行しても一覧に残る（あとで考え直せるように）。登録は各画面と同じ API を通すので、重複チェックや確認履歴も同じに働く。
// 登録まわりの考え方は lib/llm-analysis.ts の先頭を参照。

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, ArrowLeft, FileText, Loader2, RotateCw, Sparkles, Trash2, UploadCloud } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { TopBar } from "@/components/top-bar"
import { LabelChip, LabelChips } from "@/components/label-chip"
import { cn } from "@/lib/utils"
import { normalizeName } from "@/lib/normalize"
import { useProject } from "@/app/project-context"
import type { GraphNode, Label, LabelPair, RelationshipType } from "@/lib/graph-types"
import {
  LLM_ANALYSIS_MODEL_LABEL,
  type Extraction, type ExtractionSummary, type LabelCandidate, type LabelRef,
  type NodeCandidate, type NodeRef, type RelTypeCandidate, type RelationshipCandidate,
} from "@/lib/llm-analysis-types"

type Tab = "labels" | "relTypes" | "nodes" | "relationships"
const TABS: { id: Tab; name: string; target: "schema" | "graph" }[] = [
  { id: "labels", name: "ラベル", target: "schema" },
  { id: "relTypes", name: "リレーションシップタイプ", target: "schema" },
  { id: "nodes", name: "ノード", target: "graph" },
  { id: "relationships", name: "リレーションシップ", target: "graph" },
]
// その文書で行った抽出のタブだけを出す（0件のタブが「抽出して0件」か「抽出していない」か分からなくならないように）
const tabsOf = (e: Extraction) => TABS.filter((t) => e.targets[t.target])

// 行ごとに選べるアクション。先頭の「見送り」が既定。
type ActionOption = { id: string; name: string }
const SKIP: ActionOption = { id: "skip", name: "見送り" }

type Update = { id: string; outcome: string; resultLabelId?: string; resultNodeId?: string }

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json()
    return data?.error ?? fallback
  } catch {
    return fallback
  }
}

export function LlmAnalysisScreen({ active }: { active?: boolean }) {
  const { currentProject, loading: projectLoading } = useProject()
  const projectId = currentProject?.id

  // ─── 一覧と解析フォーム ───
  const [list, setList] = useState<ExtractionSummary[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [useSchema, setUseSchema] = useState(true)
  const [useGraph, setUseGraph] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ExtractionSummary | null>(null)
  const [deleting, setDeleting] = useState(false)

  // ─── 開いている解析結果 ───
  const [current, setCurrent] = useState<Extraction | null>(null)
  const [opening, setOpening] = useState(false)
  const [tab, setTab] = useState<Tab>("labels")
  const [actions, setActions] = useState<Record<string, string>>({})
  const [refEdits, setRefEdits] = useState<Record<string, { source?: LabelRef | null; target?: LabelRef | null }>>({})
  // 新規登録するときに名前を変えたもの（候補 id → 名前）
  const [nameEdits, setNameEdits] = useState<Record<string, string>>({})
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [showDone, setShowDone] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [rerunning, setRerunning] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  // ─── 照合に使う既存データ ───
  const [labels, setLabels] = useState<Label[]>([])
  const [relTypes, setRelTypes] = useState<RelationshipType[]>([])
  const [nodes, setNodes] = useState<GraphNode[]>([])

  const fetchList = useCallback(async () => {
    if (!projectId) return
    setListLoading(true)
    try {
      const res = await fetch(`/api/extractions?projectId=${projectId}`)
      const data = await res.json()
      setList(Array.isArray(data) ? data : [])
    } finally {
      setListLoading(false)
    }
  }, [projectId])

  const fetchExisting = useCallback(async () => {
    if (!projectId) return
    const [l, t, n] = await Promise.all([
      fetch(`/api/labels?projectId=${projectId}`).then((r) => r.json()),
      fetch(`/api/relationship-types?projectId=${projectId}`).then((r) => r.json()),
      fetch(`/api/nodes?projectId=${projectId}`).then((r) => r.json()),
    ])
    setLabels(Array.isArray(l) ? l : [])
    setRelTypes(Array.isArray(t) ? t : [])
    setNodes(Array.isArray(n) ? n : [])
  }, [projectId])

  useEffect(() => {
    if (projectLoading) return
    setList([]); setCurrent(null); setFile(null); setAnalyzeError(null)
  }, [projectId, projectLoading])

  useEffect(() => {
    if (active && projectId) { fetchList(); fetchExisting() }
  }, [active, projectId, fetchList, fetchExisting])

  const resetDetailState = () => {
    setActions({}); setRefEdits({}); setNameEdits({}); setRowErrors({}); setDetailError(null); setShowDone(false)
  }

  const openExtraction = async (id: string) => {
    setOpening(true)
    try {
      const res = await fetch(`/api/extractions/${id}`)
      if (!res.ok) { setAnalyzeError(await readError(res, "解析結果を開けませんでした")); return }
      const data: Extraction = await res.json()
      resetDetailState()
      setCurrent(data)
      setTab(firstTab(data))
      setUseSchema(data.targets.schema); setUseGraph(data.targets.graph); setFile(null)
    } finally {
      setOpening(false)
    }
  }

  const canAnalyze = (useSchema || useGraph) && !!file && !analyzing

  const handleAnalyze = async () => {
    if (!projectId || !file || !(useSchema || useGraph)) return
    setAnalyzing(true)
    setAnalyzeError(null)
    try {
      const form = new FormData()
      form.append("file", file)
      form.append("projectId", projectId)
      form.append("schema", String(useSchema))
      form.append("graph", String(useGraph))
      const res = await fetch("/api/extractions", { method: "POST", body: form })
      if (!res.ok) { setAnalyzeError(await readError(res, "解析に失敗しました")); return }
      const data: Extraction = await res.json()
      resetDetailState()
      setCurrent(data)
      setTab(firstTab(data))
      fetchList()
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : String(err))
    } finally {
      setAnalyzing(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await fetch(`/api/extractions/${deleteTarget.id}`, { method: "DELETE" })
      setDeleteTarget(null)
      fetchList()
    } finally {
      setDeleting(false)
    }
  }

  // ─── 名前の引き当て ───
  const labelById = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels])
  const typeById = useMemo(() => new Map(relTypes.map((t) => [t.id, t])), [relTypes])
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const labelCandById = useMemo(() => new Map((current?.labels ?? []).map((c) => [c.id, c])), [current])
  const nodeCandById = useMemo(() => new Map((current?.nodes ?? []).map((c) => [c.id, c])), [current])
  const labelName = (id: string) => labelById.get(id)?.name ?? "（削除済み）"

  // ラベル候補を参照する始点・終点。実行済みなら、その結果のラベルを指す
  const resolveLabelRef = (ref: LabelRef | null): { id: string | null; name: string; pendingCand?: LabelCandidate } => {
    if (!ref) return { id: null, name: "" }
    if (ref.kind === "label") return { id: ref.id, name: labelName(ref.id) }
    const cand = labelCandById.get(ref.id)
    if (!cand) return { id: null, name: "（候補が見つかりません）" }
    if (cand.resultLabelId) return { id: cand.resultLabelId, name: labelName(cand.resultLabelId) }
    return { id: null, name: cand.name, pendingCand: cand }
  }
  const resolveNodeRef = (ref: NodeRef): { id: string | null; name: string; labelIds: string[]; pendingCand?: NodeCandidate } => {
    if (ref.kind === "node") {
      const n = nodeById.get(ref.id)
      return { id: ref.id, name: n?.name ?? "（削除済み）", labelIds: n?.labelIds ?? [] }
    }
    const cand = nodeCandById.get(ref.id)
    if (!cand) return { id: null, name: "（候補が見つかりません）", labelIds: [] }
    if (cand.resultNodeId) {
      const n = nodeById.get(cand.resultNodeId)
      return { id: cand.resultNodeId, name: n?.name ?? cand.name, labelIds: n?.labelIds ?? cand.labelIds }
    }
    return { id: null, name: cand.name, labelIds: cand.labelIds, pendingCand: cand }
  }

  const sourceOf = (c: RelTypeCandidate) => (refEdits[c.id]?.source !== undefined ? refEdits[c.id].source! : c.source)
  const targetOf = (c: RelTypeCandidate) => (refEdits[c.id]?.target !== undefined ? refEdits[c.id].target! : c.target)

  const actionOptions = (kind: Tab, c: LabelCandidate | RelTypeCandidate | NodeCandidate | RelationshipCandidate): ActionOption[] => {
    if (kind === "labels") {
      const l = c as LabelCandidate
      return [SKIP, ...(l.similarLabelId && labelById.has(l.similarLabelId) ? [{ id: "synonym", name: "同義語登録" }] : []), { id: "new", name: "新規ラベル登録" }]
    }
    if (kind === "relTypes") {
      const t = c as RelTypeCandidate
      return [SKIP, { id: "new", name: "新規タイプ登録" }, ...(t.similarTypeId && typeById.has(t.similarTypeId) ? [{ id: "addPair", name: "既存タイプにペア追加" }] : [])]
    }
    if (kind === "nodes") return [SKIP, { id: "new", name: "新規ノード登録" }]
    return [SKIP, { id: "register", name: "登録" }]
  }
  const actionOf = (id: string) => actions[id] ?? "skip"
  const nameOf = (c: { id: string; name: string }) => (nameEdits[c.id] ?? c.name).trim()

  const rowsOf = (kind: Tab) => {
    const all = (current?.[kind] ?? []) as (LabelCandidate | RelTypeCandidate | NodeCandidate | RelationshipCandidate)[]
    return showDone ? all : all.filter((c) => c.status === "pending")
  }
  const pendingOf = (kind: Tab) => ((current?.[kind] ?? []) as { status: string }[]).filter((c) => c.status === "pending").length

  // ─── アクション実行（今のタブの未処理の行すべて） ───
  const execute = async () => {
    if (!current || !projectId) return
    // 見送りのままの行は実行しない（一覧に残す）
    const rows = ((current[tab] ?? []) as { id: string; status: string }[])
      .filter((c) => c.status === "pending" && actionOf(c.id) !== "skip")
    if (rows.length === 0) return
    setExecuting(true)
    setDetailError(null)
    const updates: Update[] = []
    const errors: Record<string, string> = {}
    try {
      if (tab === "labels") await runLabels(rows as LabelCandidate[], updates, errors)
      if (tab === "relTypes") await runRelTypes(rows as RelTypeCandidate[], updates, errors)
      if (tab === "nodes") await runNodes(rows as NodeCandidate[], updates, errors)
      if (tab === "relationships") await runRelationships(rows as RelationshipCandidate[], updates, errors)

      if (updates.length > 0) {
        const res = await fetch(`/api/extractions/${current.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [tab]: updates }),
        })
        if (res.ok) setCurrent(await res.json())
        else setDetailError(await readError(res, "結果を記録できませんでした"))
      }
      setRowErrors((prev) => {
        const next = { ...prev }
        for (const r of rows) delete next[r.id]
        return { ...next, ...errors }
      })
      if (Object.keys(errors).length > 0) {
        setDetailError(`${Object.keys(errors).length}件は登録できませんでした。行の赤い文字を確認してください。`)
      }
      await fetchExisting()
      fetchList()
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : String(err))
    } finally {
      setExecuting(false)
    }
  }

  // 同じラベルへの同義語追加が続いても上書きし合わないよう、1件ずつ順に実行する
  const runLabels = async (rows: LabelCandidate[], updates: Update[], errors: Record<string, string>) => {
    const latest = new Map(labels.map((l) => [l.id, l]))
    for (const c of rows) {
      const action = actionOf(c.id)
      if (action === "synonym" && c.similarLabelId) {
        const target = latest.get(c.similarLabelId)
        if (!target) { errors[c.id] = "同義語の行き先のラベルが見つかりません"; continue }
        const res = await fetch(`/api/labels/${target.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ synonyms: [...(target.synonyms ?? []), c.name] }),
        })
        if (!res.ok) { errors[c.id] = await readError(res, "同義語を登録できませんでした"); continue }
        latest.set(target.id, await res.json())
        updates.push({ id: c.id, outcome: `「${target.name}」の同義語に登録`, resultLabelId: target.id })
        continue
      }
      const res = await fetch("/api/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, name: nameOf(c), description: c.description }),
      })
      if (!res.ok) { errors[c.id] = await readError(res, "ラベルを登録できませんでした"); continue }
      const created: Label = await res.json()
      latest.set(created.id, created)
      updates.push({ id: c.id, outcome: `新規ラベル「${created.name}」として登録`, resultLabelId: created.id })
    }
  }

  const runRelTypes = async (rows: RelTypeCandidate[], updates: Update[], errors: Record<string, string>) => {
    const latest = new Map(relTypes.map((t) => [t.id, t]))
    const addPairTo = async (type: RelationshipType, pair: LabelPair): Promise<string | null> => {
      const pairs = type.labelPairs ?? []
      if (pairs.some((p) => p.sourceLabelId === pair.sourceLabelId && p.targetLabelId === pair.targetLabelId)) return null
      const res = await fetch(`/api/relationship-types/${type.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labelPairs: [...pairs, pair] }),
      })
      if (!res.ok) return await readError(res, "ペアを追加できませんでした")
      latest.set(type.id, await res.json())
      return null
    }
    for (const c of rows) {
      const action = actionOf(c.id)
      const src = resolveLabelRef(sourceOf(c))
      const tgt = resolveLabelRef(targetOf(c))
      if (src.pendingCand || tgt.pendingCand) {
        errors[c.id] = `ラベル候補「${nameOf((src.pendingCand ?? tgt.pendingCand)!)}」を先にラベルのタブで登録してください`
        continue
      }
      if (!src.id || !tgt.id) { errors[c.id] = "始点(A)と終点(B)のラベルを選んでください"; continue }
      const pair = { sourceLabelId: src.id, targetLabelId: tgt.id }
      if (action === "addPair" && c.similarTypeId) {
        const type = latest.get(c.similarTypeId)
        if (!type) { errors[c.id] = "ペアを足す先のタイプが見つかりません"; continue }
        const err = await addPairTo(type, pair)
        if (err) { errors[c.id] = err; continue }
        updates.push({ id: c.id, outcome: `「${type.name}」にペアを追加` })
        continue
      }
      // 同じ名前のタイプをこの実行の中で先に作っていたら、そちらにペアを足す（同名タイプを2つ作らない）
      const sameName = [...latest.values()].find((t) => normalizeName(t.name) === normalizeName(nameOf(c)))
      if (sameName) {
        const err = await addPairTo(sameName, pair)
        if (err) { errors[c.id] = err; continue }
        updates.push({ id: c.id, outcome: `同じ名前の「${sameName.name}」にペアを追加` })
        continue
      }
      const res = await fetch("/api/relationship-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, name: nameOf(c), description: c.description, labelPairs: [pair] }),
      })
      if (!res.ok) { errors[c.id] = await readError(res, "タイプを登録できませんでした"); continue }
      const created: RelationshipType = await res.json()
      latest.set(created.id, created)
      updates.push({ id: c.id, outcome: `新規タイプ「${created.name}」として登録` })
    }
  }

  const runNodes = async (rows: NodeCandidate[], updates: Update[], errors: Record<string, string>) => {
    for (const c of rows) {
      const res = await fetch("/api/nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, name: nameOf(c), labelIds: c.labelIds,
          properties: Object.keys(c.properties).length ? c.properties : undefined,
        }),
      })
      if (!res.ok) { errors[c.id] = await readError(res, "ノードを登録できませんでした"); continue }
      const created: GraphNode = await res.json()
      updates.push({ id: c.id, outcome: `新規ノード「${created.name}」として登録`, resultNodeId: created.id })
    }
  }

  const runRelationships = async (rows: RelationshipCandidate[], updates: Update[], errors: Record<string, string>) => {
    for (const c of rows) {
      const s = resolveNodeRef(c.start)
      const e = resolveNodeRef(c.end)
      if (s.pendingCand || e.pendingCand) {
        errors[c.id] = `ノード候補「${nameOf((s.pendingCand ?? e.pendingCand)!)}」を先にノードのタブで登録してください`
        continue
      }
      if (!s.id || !e.id) { errors[c.id] = "始点・終点のノードが見つかりません"; continue }
      const res = await fetch("/api/relationships", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, startNodeId: s.id, relTypeId: c.relTypeId, endNodeId: e.id,
          evidence: c.evidence, sourceDocName: current?.sourceDocName,
        }),
      })
      if (!res.ok) { errors[c.id] = await readError(res, "リレーションシップを登録できませんでした"); continue }
      updates.push({ id: c.id, outcome: "登録" })
    }
  }

  const handleRerunGraph = async () => {
    if (!current) return
    setRerunning(true)
    setDetailError(null)
    try {
      const res = await fetch(`/api/extractions/${current.id}/graph`, { method: "POST" })
      if (!res.ok) { setDetailError(await readError(res, "グラフデータ抽出に失敗しました")); return }
      setCurrent(await res.json())
      fetchList()
    } finally {
      setRerunning(false)
    }
  }

  // ─── 表示部品 ───
  const ActionSelect = ({ kind, c }: { kind: Tab; c: { id: string; status: string; outcome?: string } }) => {
    if (c.status === "done") return <span className="text-xs text-muted-foreground">{c.outcome}</span>
    const options = actionOptions(kind, c as never)
    const selected = actionOf(c.id)
    return (
      <div className="inline-flex overflow-hidden rounded-md border border-border" role="radiogroup">
        {options.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={selected === o.id}
            className={cn(
              "whitespace-nowrap border-l border-border px-2 py-1 text-xs transition-colors first:border-l-0",
              selected !== o.id ? "text-muted-foreground hover:bg-muted"
                : o.id === "skip" ? "bg-muted font-medium text-foreground"
                  : "bg-emerald-100 font-medium text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100",
            )}
            disabled={executing}
            onClick={() => setActions((prev) => ({ ...prev, [c.id]: o.id }))}>
            {o.name}
          </button>
        ))}
      </div>
    )
  }

  // 候補名。新規登録を選んでいるときは、名前を変えてから登録できる
  const NameCell = ({ c }: { c: { id: string; name: string; status: string } }) => {
    if (c.status === "pending" && actionOf(c.id) === "new") {
      return (
        <input
          className="h-8 w-full rounded-md border border-emerald-400 bg-background px-2 text-sm font-medium text-foreground"
          value={nameEdits[c.id] ?? c.name}
          disabled={executing}
          aria-label="登録する名前"
          onChange={(e) => setNameEdits((prev) => ({ ...prev, [c.id]: e.target.value }))}
        />
      )
    }
    return <span className="font-medium text-foreground">{c.name}</span>
  }
  // アクションに見送り以外を選んだ行は色を変える（実行ボタンと同じ色の薄いもの）
  const rowClass = (c: { id: string; status: string }) => cn(
    "border-t border-border transition-colors",
    c.status === "done" && "opacity-60",
    c.status === "pending" && actionOf(c.id) !== "skip" && "bg-emerald-50 dark:bg-emerald-950/30",
  )

  const Evidence = ({ text }: { text: string }) =>
    text ? <span className="mt-0.5 block text-xs text-muted-foreground">「{text}」</span> : null

  const RowError = ({ id }: { id: string }) =>
    rowErrors[id] ? <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{rowErrors[id]}</span> : null

  const labelRefValue = (ref: LabelRef | null) => (ref ? `${ref.kind}:${ref.id}` : "")
  const parseLabelRef = (v: string): LabelRef | null => {
    if (!v) return null
    const [kind, id] = v.split(":")
    return kind === "label" ? { kind: "label", id } : { kind: "candidate", id }
  }
  const sortedLabels = useMemo(() => labels.filter((l) => !l.system).sort((a, b) => a.name.localeCompare(b.name, "ja")), [labels])
  const pendingLabelCands = (current?.labels ?? []).filter((c) => c.status === "pending")

  const LabelRefSelect = ({ c, side }: { c: RelTypeCandidate; side: "source" | "target" }) => {
    const ref = side === "source" ? sourceOf(c) : targetOf(c)
    const resolved = resolveLabelRef(ref)
    // 実行済みのラベル候補は、結果のラベルとして選ばれた状態にする
    const value = ref?.kind === "candidate" && resolved.id ? `label:${resolved.id}` : labelRefValue(ref)
    if (c.status === "done") return <LabelChip name={resolved.name || "—"} />
    return (
      <div>
        <select
          className={cn(
            "h-8 w-full rounded-md border bg-background px-2 text-xs",
            !value ? "border-amber-400" : "border-border",
          )}
          value={value}
          disabled={executing}
          onChange={(e) => setRefEdits((prev) => ({ ...prev, [c.id]: { ...prev[c.id], [side]: parseLabelRef(e.target.value) } }))}>
          <option value="">（選んでください）</option>
          <optgroup label="既存ラベル">
            {sortedLabels.map((l) => <option key={l.id} value={`label:${l.id}`}>{l.name}</option>)}
          </optgroup>
          {pendingLabelCands.length > 0 && (
            <optgroup label="ラベル候補（未登録）">
              {pendingLabelCands.map((l) => <option key={l.id} value={`candidate:${l.id}`}>{nameOf(l)}（候補）</option>)}
            </optgroup>
          )}
        </select>
        {!value && <span className="mt-0.5 block text-xs text-muted-foreground">AIの案：{side === "source" ? c.sourceName : c.targetName}</span>}
        {resolved.pendingCand && <span className="mt-0.5 block text-xs text-amber-600 dark:text-amber-400">未登録のラベル候補</span>}
      </div>
    )
  }

  const NodeRefCell = ({ r }: { r: NodeRef }) => {
    const n = resolveNodeRef(r)
    return (
      <div className="min-w-0">
        <LabelChips names={n.labelIds.map(labelName)} />
        <span className="mt-1 block font-medium text-foreground">{n.name}</span>
        {n.pendingCand && <span className="block text-xs text-amber-600 dark:text-amber-400">未登録のノード候補</span>}
      </div>
    )
  }

  const pairMismatch = (c: RelationshipCandidate) => {
    const type = typeById.get(c.relTypeId)
    if (!type) return false
    const s = resolveNodeRef(c.start).labelIds
    const e = resolveNodeRef(c.end).labelIds
    return !(type.labelPairs ?? []).some((p) => s.includes(p.sourceLabelId) && e.includes(p.targetLabelId))
  }

  const thClass = "sticky top-0 z-10 bg-card px-3 py-2 text-left text-xs font-medium text-muted-foreground"
  const tdClass = "px-3 py-2.5 align-top text-sm"

  const tabRows = current ? rowsOf(tab) : []
  const tabPending = current ? pendingOf(tab) : 0
  const tabRegisterCount = current
    ? ((current[tab] ?? []) as { id: string; status: string }[]).filter((c) => c.status === "pending" && actionOf(c.id) !== "skip").length
    : 0
  const tabName = TABS.find((t) => t.id === tab)?.name ?? ""

  return (
    <div className="flex h-full flex-col">
      <TopBar group="AI活用" title="LLMによる解析" />

      {!currentProject ? (
        <p className="p-6 text-center text-sm text-muted-foreground">プロジェクトを選択してください</p>
      ) : (
        // ─── 解析フォーム（常に出す）と、その下に解析結果か、これまでに解析した文書 ───
        // ファイル指定と解析ボタンの作りは、オントロジー抽出（review-screen）に揃えている。
        <div className="flex-1 overflow-auto p-6">
          <div className="mb-6 flex items-start justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              既存文書をLLMで解析して、スキーマ（ラベル／リレーションシップタイプ）とグラフデータ（ノード／リレーションシップ）の候補を抽出します。
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <span className="whitespace-nowrap text-sm font-medium text-foreground">解析AIモデル（LLM）</span>
              <span className="whitespace-nowrap rounded-md border border-border px-3 py-1.5 text-sm text-foreground">{LLM_ANALYSIS_MODEL_LABEL}</span>
            </div>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">ファイル指定</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                  <span className="font-medium text-foreground">抽出対象</span>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={useSchema} onChange={(e) => setUseSchema(e.target.checked)} disabled={analyzing} />
                    スキーマ抽出
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={useGraph} onChange={(e) => setUseGraph(e.target.checked)} disabled={analyzing} />
                    グラフデータ抽出
                  </label>
                  {!(useSchema || useGraph) && (
                    <span className="text-xs text-amber-600 dark:text-amber-400">抽出対象を1つ以上選んでください</span>
                  )}
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.pdf"
                  className="hidden"
                  onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = "" }}
                />
                <div className="flex items-stretch gap-4">
                  {/* D&D エリア（可変・広め） */}
                  <div className="min-w-0 flex-1">
                    <div
                      className="flex h-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/40 px-6 py-6 text-center"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.preventDefault(); setFile(e.dataTransfer.files?.[0] ?? null) }}
                    >
                      <UploadCloud className="h-7 w-7 text-muted-foreground" />
                      <p className="mt-2 text-sm text-foreground">
                        {file
                          ? <span className="inline-flex items-center gap-1.5 font-medium"><FileText className="h-4 w-4" />{file.name}</span>
                          : "ここにファイルをドラッグ＆ドロップ"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">対応形式：PDF, TXT</p>
                      <Button size="sm" variant="outline" className="mt-3 bg-transparent"
                        disabled={analyzing}
                        onClick={() => fileInputRef.current?.click()}>
                        ファイルを選択
                      </Button>
                    </div>
                  </div>

                  {/* 解析ボタン（テキストが折り返さない幅で固定） */}
                  <Button
                    disabled={!canAnalyze}
                    className="h-auto w-48 shrink-0 gap-2 self-stretch whitespace-nowrap border-0 text-base font-semibold text-white shadow-lg transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{ background: "linear-gradient(135deg, #be185d 0%, #7e22ce 50%, #4c1d95 100%)" }}
                    onClick={handleAnalyze}
                  >
                    {analyzing
                      ? <><Loader2 className="h-5 w-5 animate-spin" />解析中...</>
                      : <><Sparkles className="h-5 w-5" />LLMで解析する</>}
                  </Button>
                </div>

                {analyzing && <p className="text-xs text-muted-foreground">解析中です。長い文書は数分かかります。</p>}
                {analyzeError && <p className="text-sm text-destructive">{analyzeError}</p>}
              </CardContent>
            </Card>

            {!current ? (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-foreground">これまでに解析した文書</h2>
              {listLoading && list.length === 0 ? (
                <div className="flex h-20 items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
              ) : list.length === 0 ? (
                <p className="text-sm text-muted-foreground">まだありません</p>
              ) : (
                <table className="w-full border-collapse overflow-hidden rounded-lg border border-border text-sm">
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">文書名</th>
                      <th className="px-3 py-2 text-left font-medium">抽出対象</th>
                      <th className="px-3 py-2 text-left font-medium">解析日</th>
                      <th className="px-3 py-2 text-left font-medium">残っている候補</th>
                      <th className="w-24 px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((e) => (
                      <tr key={e.id} className="cursor-pointer border-t border-border hover:bg-muted/40" onClick={() => openExtraction(e.id)}>
                        <td className="px-3 py-2 font-medium text-foreground">{e.sourceDocName}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {[e.targets.schema && "スキーマ", e.targets.graph && "グラフデータ"].filter(Boolean).join("・")}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString("ja-JP")}</td>
                        <td className="px-3 py-2">{e.pending}件</td>
                        <td className="px-3 py-2 text-right" onClick={(ev) => ev.stopPropagation()}>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground"
                            aria-label={`${e.sourceDocName}の解析結果を削除`} onClick={() => setDeleteTarget(e)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {opening && <p className="text-xs text-muted-foreground">開いています…</p>}
            </section>
            ) : (
            // ─── 解析結果 ───
            <Card className="gap-0 py-0">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
                <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="text-base font-semibold text-foreground">解析結果</span>
                  <span className="flex min-w-0 items-center gap-1.5 text-sm text-foreground">
                    <FileText className="h-4 w-4 shrink-0" /><span className="truncate">{current.sourceDocName}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    抽出対象：{[current.targets.schema && "スキーマ抽出", current.targets.graph && "グラフデータ抽出"].filter(Boolean).join("・")}
                  </span>
                  <span className="text-xs text-muted-foreground">利用モデル：{LLM_ANALYSIS_MODEL_LABEL}</span>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {!current.targets.graph && (
                    <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-transparent" onClick={handleRerunGraph} disabled={rerunning || executing}>
                      {rerunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
                      グラフデータ抽出を実行
                    </Button>
                  )}
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
                    処理済みも表示
                  </label>
                  <Button size="sm" variant="ghost" className="h-8 gap-1 px-2" onClick={() => { setCurrent(null); fetchList() }}>
                    <ArrowLeft className="h-4 w-4" />文書一覧へ
                  </Button>
                </div>
              </div>

              <div className="flex gap-1 border-b border-border px-3">
                {tabsOf(current).map((t) => (
                  <button key={t.id} type="button"
                    className={cn(
                      "border-b-2 px-3 py-2 text-sm transition-colors",
                      tab === t.id ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => { setTab(t.id); setDetailError(null) }}>
                    {t.name}<span className="ml-1.5 text-xs text-muted-foreground">{pendingOf(t.id)}</span>
                  </button>
                ))}
              </div>

              {current.notes.length > 0 && (
                <div className="border-b border-border px-5 py-2 text-xs text-muted-foreground">
                  {current.notes.map((n, i) => <p key={i}>{n}</p>)}
                </div>
              )}

              {(tab === "nodes" || tab === "relationships") && (
                <div className="mx-5 mt-3 flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  <span>
                    グラフデータは登録済みのスキーマだけで抽出しています。スキーマ候補を登録したあとにやり直すと、新しいラベル・タイプを使った候補も出ます。未処理のノード・リレーションシップ候補は置き換わります。
                  </span>
                  <Button size="sm" variant="outline" className="h-7 shrink-0 gap-1.5 bg-transparent" onClick={handleRerunGraph} disabled={rerunning || executing}>
                    {rerunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
                    グラフデータ抽出をやり直す
                  </Button>
                </div>
              )}

              <div className="px-5 py-3">
                {tabRows.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    {pendingOf(tab) === 0 && ((current[tab] ?? []) as unknown[]).length > 0
                      ? "未処理の候補はありません"
                      : "この文書からは候補が見つかりませんでした"}
                  </p>
                ) : (
              <table className="w-full border-collapse">
                <thead>
                  {tab === "labels" && (
                    <tr>
                      <th className={thClass}>ラベル候補</th>
                      <th className={thClass}>既存類似ラベル</th>
                      <th className={cn(thClass, "w-80")}>アクション選択</th>
                    </tr>
                  )}
                  {tab === "relTypes" && (
                    <tr>
                      <th className={thClass}>リレーションシップタイプ候補</th>
                      <th className={cn(thClass, "w-44")}>始点(A)</th>
                      <th className={cn(thClass, "w-44")}>終点(B)</th>
                      <th className={thClass}>既存類似タイプ</th>
                      <th className={cn(thClass, "w-80")}>アクション選択</th>
                    </tr>
                  )}
                  {tab === "nodes" && (
                    <tr>
                      <th className={thClass}>ノード候補</th>
                      <th className={thClass}>ラベル・プロパティ</th>
                      <th className={thClass}>既存類似ノード</th>
                      <th className={cn(thClass, "w-56")}>アクション選択</th>
                    </tr>
                  )}
                  {tab === "relationships" && (
                    <tr>
                      <th className={thClass}>始点ノード(A)</th>
                      <th className={thClass}>リレーションシップタイプ</th>
                      <th className={thClass}>終点ノード(B)</th>
                      <th className={thClass}>根拠</th>
                      <th className={cn(thClass, "w-40")}>アクション選択</th>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {tab === "labels" && (tabRows as LabelCandidate[]).map((c) => (
                    <tr key={c.id} className={rowClass(c)}>
                      <td className={tdClass}>
                        {NameCell({ c })}
                        {c.description && <span className="mt-0.5 block text-xs text-muted-foreground">{c.description}</span>}
                        {Evidence({ text: c.evidence })}
                        {RowError({ id: c.id })}
                      </td>
                      <td className={tdClass}>
                        {c.similarLabelId && labelById.has(c.similarLabelId) ? (
                          <>
                            <LabelChip name={labelName(c.similarLabelId)} />
                            <span className="mt-1 block text-xs text-muted-foreground">{c.similarReason}</span>
                          </>
                        ) : <span className="text-xs text-muted-foreground">なし</span>}
                      </td>
                      <td className={tdClass}>{ActionSelect({ kind: "labels", c })}</td>
                    </tr>
                  ))}

                  {tab === "relTypes" && (tabRows as RelTypeCandidate[]).map((c) => (
                    <tr key={c.id} className={rowClass(c)}>
                      <td className={tdClass}>
                        {NameCell({ c })}
                        {c.description && <span className="mt-0.5 block text-xs text-muted-foreground">{c.description}</span>}
                        {Evidence({ text: c.evidence })}
                        {RowError({ id: c.id })}
                      </td>
                      <td className={tdClass}>{LabelRefSelect({ c, side: "source" })}</td>
                      <td className={tdClass}>{LabelRefSelect({ c, side: "target" })}</td>
                      <td className={tdClass}>
                        {c.similarTypeId && typeById.has(c.similarTypeId) ? (
                          <>
                            <span className="text-sm text-foreground">{typeById.get(c.similarTypeId)!.name}</span>
                            <span className="mt-0.5 block text-xs text-muted-foreground">{c.similarReason}</span>
                          </>
                        ) : <span className="text-xs text-muted-foreground">なし</span>}
                      </td>
                      <td className={tdClass}>{ActionSelect({ kind: "relTypes", c })}</td>
                    </tr>
                  ))}

                  {tab === "nodes" && (tabRows as NodeCandidate[]).map((c) => (
                    <tr key={c.id} className={rowClass(c)}>
                      <td className={tdClass}>
                        {NameCell({ c })}
                        {c.sourceText && normalizeName(c.sourceText) !== normalizeName(c.name) && (
                          <span className="mt-0.5 block text-xs text-muted-foreground">文書の表記：{c.sourceText}</span>
                        )}
                        {Evidence({ text: c.evidence })}
                        {RowError({ id: c.id })}
                      </td>
                      <td className={tdClass}>
                        <LabelChips names={c.labelIds.map(labelName)} />
                        {Object.entries(c.properties).map(([k, v]) => (
                          <span key={k} className="mt-1 block text-xs text-muted-foreground">{k}：{v}</span>
                        ))}
                      </td>
                      <td className={tdClass}>
                        {c.similarNodeId && nodeById.has(c.similarNodeId) ? (
                          <>
                            <LabelChips names={(nodeById.get(c.similarNodeId)!.labelIds ?? []).map(labelName)} />
                            <span className="mt-1 block text-sm text-foreground">{nodeById.get(c.similarNodeId)!.name}</span>
                            <span className="block text-xs text-muted-foreground">{c.similarReason}</span>
                          </>
                        ) : <span className="text-xs text-muted-foreground">なし</span>}
                      </td>
                      <td className={tdClass}>{ActionSelect({ kind: "nodes", c })}</td>
                    </tr>
                  ))}

                  {tab === "relationships" && (tabRows as RelationshipCandidate[]).map((c) => (
                    <tr key={c.id} className={rowClass(c)}>
                      <td className={tdClass}>{NodeRefCell({ r: c.start })}</td>
                      <td className={tdClass}>
                        <span className="text-foreground">{typeById.get(c.relTypeId)?.name ?? "（削除済み）"}</span>
                        {pairMismatch(c) && (
                          <span className="mt-1 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="h-3 w-3" />ラベルペアに合いません
                          </span>
                        )}
                        {RowError({ id: c.id })}
                      </td>
                      <td className={tdClass}>{NodeRefCell({ r: c.end })}</td>
                      <td className={cn(tdClass, "text-xs text-muted-foreground")}>{c.evidence && `「${c.evidence}」`}</td>
                      <td className={tdClass}>{ActionSelect({ kind: "relationships", c })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
              </div>

              <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-border bg-card px-5 py-3">
                <span className="text-xs text-muted-foreground">
                  {detailError
                    ? <span className="text-red-600 dark:text-red-400">{detailError}</span>
                    : tabPending > 0 ? `${tabName}：登録するもの ${tabRegisterCount}件（見送りの ${tabPending - tabRegisterCount}件は残ります）` : ""}
                </span>
                <Button onClick={execute} disabled={executing || tabRegisterCount === 0}
                  className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-700">
                  {executing && <Loader2 className="h-4 w-4 animate-spin" />}{tabName}のアクションを実行
                </Button>
              </div>
            </Card>
            )}
          </div>
        </div>
      )}

      <Dialog open={!!deleteTarget} onOpenChange={(v) => { if (!v && !deleting) setDeleteTarget(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>解析結果を削除</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            「{deleteTarget?.sourceDocName}」の解析結果を削除します。登録済みのラベル・ノードなどは消えません。
          </p>
          <DialogFooter>
            <Button variant="outline" className="bg-transparent" onClick={() => setDeleteTarget(null)} disabled={deleting}>キャンセル</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting} className="gap-1.5">
              {deleting && <Loader2 className="h-4 w-4 animate-spin" />}削除する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// 開いたときに最初に見せるタブ（未処理の候補があるところ）
function firstTab(e: Extraction): Tab {
  const tabs = tabsOf(e)
  for (const t of tabs) {
    if ((e[t.id] as { status: string }[]).some((c) => c.status === "pending")) return t.id
  }
  return tabs[0]?.id ?? "labels"
}
