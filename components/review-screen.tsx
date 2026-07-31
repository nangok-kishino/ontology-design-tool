"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { TopBar } from "@/components/top-bar"
import { useProject } from "@/app/project-context"
import { cn } from "@/lib/utils"
import type { OntologyClass, OntologyRelation } from "@/lib/types"
import { UploadCloud, FileText, Check, Sparkles, Loader2, Pencil, RotateCw, AlertTriangle } from "lucide-react"

type CandidateStatus = "確認中" | "新規追加" | "承認済み" | "却下" | "採用候補" | "本登録済み"

const MODEL_OPTIONS = [
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", provider: "Anthropic" },
  { id: "claude-opus-5", label: "Claude Opus 5", provider: "Anthropic" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "Google" },
]

type ClassCandidate = {
  id: string
  instanceNames: string[]
  proposedClassName: string
  proposedClassDescription: string
  status: CandidateStatus
  saving: boolean
}

type InstanceCandidate = {
  id: string
  name: string
  classId: string | null
  className: string
  proposedClassName: string
  pendingClassCandidateId?: string
  status: CandidateStatus
  saving: boolean
}

type RelationCandidate = {
  id: string
  sourceClassId: string | null
  sourceClassName: string
  relationName: string
  targetClassId: string | null
  targetClassName: string
  description: string
  status: CandidateStatus
  saving: boolean
}

function StatusBadge({ status }: { status: CandidateStatus }) {
  const map: Record<CandidateStatus, string> = {
    確認中: "border-border bg-muted text-muted-foreground",
    新規追加: "border-green-300 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300",
    承認済み: "border-green-300 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300",
    却下: "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300",
    採用候補: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
    本登録済み: "border-green-300 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300",
  }
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${map[status]}`}>
      {status}
    </span>
  )
}

function CountPill({ n }: { n: number }) {
  return (
    <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
      {n}
    </span>
  )
}

// 「採用」列ヘッダの全選択/全選択解除チェックボックス（行チェックと同じ見た目）
function SelectAllBox({ allSelected, disabled, onToggle }: { allSelected: boolean; disabled?: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label="全選択 / 全選択解除"
      title="全選択 / 全選択解除"
      onClick={onToggle}
      className={cn(
        "inline-flex h-5 w-5 items-center justify-center rounded border transition-colors",
        disabled
          ? "cursor-not-allowed border-input opacity-40"
          : allSelected
            ? "border-green-600 bg-green-600 text-white"
            : "cursor-pointer border-input hover:border-green-500",
      )}
    >
      {allSelected && <Check className="h-3.5 w-3.5" />}
    </button>
  )
}

export function ReviewScreen({ active, ingestVersion, onIngested }: { active?: boolean; ingestVersion?: number; onIngested?: () => void }) {
  const { currentProject } = useProject()
  const fileInputRef = useRef<HTMLInputElement>(null)
  // 直近に解析したファイル（解析後は file を null にするため、再実行用に保持する）
  const lastFileRef = useRef<File | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [analyzedFileName, setAnalyzedFileName] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState(MODEL_OPTIONS[0].id)
  const [analyzedModelLabel, setAnalyzedModelLabel] = useState<string | null>(null)

  const [classCands, setClassCands] = useState<ClassCandidate[]>([])
  const [editingClassNameId, setEditingClassNameId] = useState<string | null>(null)
  const [registeringClasses, setRegisteringClasses] = useState(false)
  const [instCands, setInstCands] = useState<InstanceCandidate[]>([])
  const [editingInstanceNameId, setEditingInstanceNameId] = useState<string | null>(null)
  const [registeringInstances, setRegisteringInstances] = useState(false)
  const [relCands, setRelCands] = useState<RelationCandidate[]>([])
  const [editingRelationNameId, setEditingRelationNameId] = useState<string | null>(null)
  const [registeringRelations, setRegisteringRelations] = useState(false)
  const [classes, setClasses] = useState<OntologyClass[]>([])
  const [existingRelations, setExistingRelations] = useState<OntologyRelation[]>([])
  // applyOntology は useCallback([]) のため、最新の既存リレーションを ref 経由で参照して
  // 「定義済みと同一（同名＋同一クラスペア）」の候補を除外する（重複抽出のはじき）。
  const existingRelationsRef = useRef<OntologyRelation[]>([])
  useEffect(() => { existingRelationsRef.current = existingRelations }, [existingRelations])

  // 既存クラス・リレーションを取得する（解析結果は消さない）。
  // 画面はマウント維持されるため、クラス管理等でクラスを追加した後に
  // この画面へ戻った際も最新の選択肢を反映できるよう再取得に使う。
  const fetchClassesAndRelations = useCallback(() => {
    if (!currentProject) return
    Promise.all([
      fetch(`/api/classes?projectId=${currentProject.id}`).then((r) => r.json()),
      fetch(`/api/relations?projectId=${currentProject.id}`).then((r) => r.json()),
    ])
      .then(([cls, rel]) => {
        setClasses(Array.isArray(cls) ? cls : [])
        setExistingRelations(Array.isArray(rel) ? rel : [])
      })
      .catch(() => {})
  }, [currentProject?.id])

  useEffect(() => {
    if (!currentProject) return

    // プロジェクトが切り替わったら解析結果はクリアする
    setFile(null)
    setAnalyzeError(null)
    setAnalyzedFileName(null)
    setAnalyzedModelLabel(null)
    setClassCands([])
    setInstCands([])
    setRelCands([])
    setEditingClassNameId(null)
    setEditingRelationNameId(null)

    fetchClassesAndRelations()
  }, [currentProject?.id])

  // 現在の候補件数を参照するためのref（active復帰時に未レビューなら保存済みを読み込む）
  const candCountRef = useRef(0)
  useEffect(() => {
    candCountRef.current = classCands.length + instCands.length + relCands.length
  }, [classCands.length, instCands.length, relCands.length])

  // この画面が表示状態になったらクラス・リレーションを再取得する
  // （他画面でのクラス追加を始点・終点クラスの選択肢へ即時反映するため）。
  useEffect(() => {
    if (active) fetchClassesAndRelations()
  }, [active, fetchClassesAndRelations])

  const updateClassCand = (id: string, u: Partial<ClassCandidate>) =>
    setClassCands((p) => p.map((c) => (c.id === id ? { ...c, ...u } : c)))
  const updateInst = (id: string, u: Partial<InstanceCandidate>) =>
    setInstCands((p) => p.map((c) => (c.id === id ? { ...c, ...u } : c)))
  const updateRel = (id: string, u: Partial<RelationCandidate>) =>
    setRelCands((p) => p.map((c) => (c.id === id ? { ...c, ...u } : c)))

  const handleFileChange = (f: File | null) => {
    if (!f) return
    setFile(f)
    setAnalyzeError(null)
  }

  // オントロジー抽出結果（共通取込み /api/ingest が返す ontology）を候補タブに反映する。
  // 解析直後と、保存済み取込み結果の読み込み時の両方で使う。
  const applyOntology = useCallback((ontology: { instances?: any[]; relations?: any[] } | null | undefined) => {
    const allInst: any[] = Array.isArray(ontology?.instances) ? ontology!.instances : []

    // isNewClass=true かつ classId なし → クラス候補タブへ（同一クラス名は1行に統合）
    const classGroups = new Map<string, { description: string; instanceNames: string[] }>()
    for (const i of allInst) {
      if (!i.isNewClass || i.classId) continue
      const key = (i.newClassName ?? "").trim()
      if (!key) continue
      if (!classGroups.has(key)) {
        classGroups.set(key, { description: i.newClassDescription ?? "", instanceNames: [] })
      }
      classGroups.get(key)!.instanceNames.push(i.name)
    }
    const classCandEntries = Array.from(classGroups.entries()).map(([name, v], idx) => ({
      id: `cc-${idx}-${name}`,
      instanceNames: v.instanceNames,
      proposedClassName: name,
      proposedClassDescription: v.description,
      status: "確認中" as CandidateStatus,
      saving: false,
    }))
    setClassCands(classCandEntries)
    const classCandIdByName = new Map(classCandEntries.map((cc) => [cc.proposedClassName, cc.id]))

    const resolvedInstCands: InstanceCandidate[] = allInst
      .filter((i) => !i.isNewClass || !!i.classId)
      .map((i) => ({
        id: i.id,
        name: i.name,
        classId: i.classId ?? null,
        className: i.className ?? "",
        proposedClassName: i.className || i.suggestedClassName || "",
        status: "確認中" as CandidateStatus,
        saving: false,
      }))

    const pendingInstCands: InstanceCandidate[] = allInst
      .filter((i) => i.isNewClass && !i.classId && (i.newClassName ?? "").trim())
      .map((i) => ({
        id: i.id,
        name: i.name,
        classId: null,
        className: "",
        proposedClassName: (i.newClassName ?? "").trim(),
        pendingClassCandidateId: classCandIdByName.get((i.newClassName ?? "").trim()),
        status: "確認中" as CandidateStatus,
        saving: false,
      }))
    setInstCands([...resolvedInstCands, ...pendingInstCands])

    // リレーション候補の重複除去：
    //   (1) バッチ内で始点・終点・名称が一致するものを1つにまとめる
    //   (2) 既に定義済みのリレーション（同名かつ同一の始点→終点クラスペアを既に持つ）は除外する
    //       ※同名でもそのクラスペアを持たない場合は「新しいペアの追加候補」として残す
    const rawRels: any[] = Array.isArray(ontology?.relations) ? ontology!.relations : []
    const existingRels = existingRelationsRef.current
    const isExistingPair = (r: any) => {
      if (!r.sourceClassId || !r.targetClassId) return false
      const name = (r.relationName || "").trim().toLowerCase()
      return existingRels.some(
        (er) =>
          (er.name || "").trim().toLowerCase() === name &&
          (er.classPairs ?? []).some((p) => p.sourceClassId === r.sourceClassId && p.targetClassId === r.targetClassId),
      )
    }
    const seenRel = new Set<string>()
    const dedupedRels = rawRels.filter((r) => {
      if (isExistingPair(r)) return false
      const key = [
        (r.sourceClassId || r.sourceClassName || "").trim().toLowerCase(),
        (r.relationName || "").trim().toLowerCase(),
        (r.targetClassId || r.targetClassName || "").trim().toLowerCase(),
      ].join("|")
      if (seenRel.has(key)) return false
      seenRel.add(key)
      return true
    })
    setRelCands(dedupedRels)
  }, [])

  // 保存済みの取込み結果（他画面＝ナレッジグラフ作成の文書取込みからの取込みも含む）を読み込む
  const loadPersistedIngestion = useCallback(async () => {
    if (!currentProject) return
    try {
      const data = await fetch(`/api/ingest?projectId=${currentProject.id}`).then((r) => r.json())
      if (data?.ontology) {
        applyOntology(data.ontology)
        setAnalyzedFileName(data.sourceDocName ?? null)
        setAnalyzedModelLabel(MODEL_OPTIONS.find((m) => m.id === data.model)?.label ?? data.model ?? null)
      }
    } catch {}
  }, [currentProject?.id, applyOntology])

  // プロジェクト変更時：クリア（上の効果）後に保存済み取込み結果を反映する
  useEffect(() => {
    loadPersistedIngestion()
  }, [currentProject?.id, loadPersistedIngestion])

  // 画面がアクティブになったとき、未レビューなら保存済み取込み結果を反映する
  // （ナレッジグラフ作成側の文書取込みからの取込みをここに反映するため）
  useEffect(() => {
    if (active && candCountRef.current === 0) loadPersistedIngestion()
  }, [active, loadPersistedIngestion])

  // トリプレット抽出画面で取込みが実行されたら（ingestVersion 変化）、この画面が非アクティブの間に
  // 保存済みオントロジー候補を反映する（1回の取込みを両画面で共有する合意仕様）。
  // 自画面がアクティブ＝ユーザー操作中のときは上書きしない（アクティブ化時の再読込に委ねる）。
  const ingestVersionRef = useRef(ingestVersion)
  useEffect(() => {
    if (ingestVersionRef.current === ingestVersion) return
    ingestVersionRef.current = ingestVersion
    if (!active) loadPersistedIngestion()
  }, [ingestVersion, active, loadPersistedIngestion])

  const handleAnalyze = async (reuseFile?: File) => {
    const target = reuseFile ?? file
    if (!target || !currentProject) return
    setAnalyzing(true)
    setAnalyzeError(null)
    // 解析開始時に前回の結果をクリアし、解析中はローディングを表示する（成功時に新結果へ差し替え）
    setClassCands([])
    setInstCands([])
    setRelCands([])
    setEditingClassNameId(null)
    setEditingRelationNameId(null)
    setEditingInstanceNameId(null)
    try {
      const fd = new FormData()
      fd.append("file", target)
      fd.append("projectId", currentProject.id)
      fd.append("model", selectedModel)
      // 共通取込み：オントロジー抽出（主）とトリプレット抽出（従属）を1回で実行。
      // トリプレット候補はナレッジグラフ作成の文書取込み画面に反映される。
      const res = await fetch("/api/ingest", { method: "POST", body: fd })
      const data = await res.json()
      if (!res.ok) { setAnalyzeError(data.error ?? "解析に失敗しました"); return }

      applyOntology(data.ontology)

      // 解析成功後、ファイル指定エリアをクリアして解析結果側に表示を切り替える
      lastFileRef.current = target
      setAnalyzedFileName(data.sourceDocName ?? target.name)
      setAnalyzedModelLabel(MODEL_OPTIONS.find((m) => m.id === selectedModel)?.label ?? selectedModel)
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ""
      // 同一取込みでトリプレット候補も保存済み。トリプレット抽出画面へ共有（再取得）を通知する。
      onIngested?.()
    } catch {
      setAnalyzeError("解析中にエラーが発生しました")
    } finally {
      setAnalyzing(false)
    }
  }

  // クラス候補の選択トグル（確認中 ⇔ 採用候補）
  const toggleClassCandidateSelection = (id: string) => {
    setClassCands((p) =>
      p.map((c) => {
        if (c.id !== id || c.status === "本登録済み") return c
        return { ...c, status: c.status === "採用候補" ? "確認中" : "採用候補" }
      })
    )
  }

  // 採用候補となっているクラスをまとめて本登録
  const registerSelectedClasses = async () => {
    if (!currentProject) return
    const targets = classCands.filter((c) => c.status === "採用候補" && c.proposedClassName.trim())
    if (targets.length === 0) return
    setRegisteringClasses(true)
    try {
      for (const cand of targets) {
        updateClassCand(cand.id, { saving: true })
        try {
          const classRes = await fetch("/api/classes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: currentProject.id,
              name: cand.proposedClassName.trim(),
              description: cand.proposedClassDescription.trim(),
            }),
          })
          const newClass: OntologyClass = await classRes.json()
          setClasses((p) => [...p, newClass])
          setInstCands((p) =>
            p.map((ic) =>
              ic.pendingClassCandidateId === cand.id
                ? { ...ic, classId: newClass.id, className: newClass.name, pendingClassCandidateId: undefined }
                : ic
            )
          )
          updateClassCand(cand.id, { status: "本登録済み", saving: false })
        } catch {
          updateClassCand(cand.id, { saving: false })
        }
      }
    } finally {
      setRegisteringClasses(false)
    }
  }

  // インスタンス候補の選択トグル（確認中 ⇔ 採用候補）
  const toggleInstCandidateSelection = (id: string) => {
    setInstCands((p) =>
      p.map((c) => {
        if (c.id !== id || c.status === "本登録済み") return c
        return { ...c, status: c.status === "採用候補" ? "確認中" : "採用候補" }
      })
    )
  }

  // 採用候補となっているインスタンスをまとめて本登録
  const registerSelectedInstances = async () => {
    if (!currentProject) return
    const targets = instCands.filter((c) => c.status === "採用候補")
    if (targets.length === 0) return
    setRegisteringInstances(true)
    try {
      for (const cand of targets) {
        if (!cand.classId) continue
        updateInst(cand.id, { saving: true })
        try {
          const res = await fetch("/api/instances", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: currentProject.id, name: cand.name, classId: cand.classId }),
          })
          // 409（同一クラス×正規化一致の重複）は既に同名インスタンスが存在する＝
          // 登録の目的は達成済みとみなし、本登録済み扱いにする（重複作成はしない）。
          if (res.ok || res.status === 409) {
            updateInst(cand.id, { status: "本登録済み", saving: false })
          } else {
            updateInst(cand.id, { saving: false })
          }
        } catch {
          updateInst(cand.id, { saving: false })
        }
      }
    } finally {
      setRegisteringInstances(false)
    }
  }

  // リレーション候補の選択トグル（確認中 ⇔ 採用候補）
  const toggleRelCandidateSelection = (id: string) => {
    setRelCands((p) =>
      p.map((c) => {
        if (c.id !== id || c.status === "本登録済み") return c
        return { ...c, status: c.status === "採用候補" ? "確認中" : "採用候補" }
      })
    )
  }

  // 採用候補となっているリレーションをまとめて本登録
  const registerSelectedRelations = async () => {
    if (!currentProject) return
    const targets = relCands.filter(
      (c) => c.status === "採用候補" && c.sourceClassId && c.targetClassId && c.relationName.trim()
    )
    if (targets.length === 0) return
    setRegisteringRelations(true)
    try {
      let relationsSnapshot = existingRelations
      for (const cand of targets) {
        updateRel(cand.id, { saving: true })
        try {
          const newPair = { sourceClassId: cand.sourceClassId as string, targetClassId: cand.targetClassId as string }
          const existing = relationsSnapshot.find((r) => r.name === cand.relationName.trim())
          if (existing) {
            const pairs = [...(existing.classPairs ?? []), newPair]
            await fetch(`/api/relations/${existing.id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ classPairs: pairs }),
            })
            relationsSnapshot = relationsSnapshot.map((r) => (r.id === existing.id ? { ...r, classPairs: pairs } : r))
          } else {
            const res = await fetch("/api/relations", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                projectId: currentProject.id,
                name: cand.relationName.trim(),
                description: cand.description,
                classPairs: [newPair],
              }),
            })
            const newRel: OntologyRelation = await res.json()
            relationsSnapshot = [...relationsSnapshot, newRel]
          }
          setExistingRelations(relationsSnapshot)
          updateRel(cand.id, { status: "本登録済み", saving: false })
        } catch {
          updateRel(cand.id, { saving: false })
        }
      }
    } finally {
      setRegisteringRelations(false)
    }
  }

  // 全選択/全選択解除（本登録済みは対象外）。すべて採用候補なら解除、そうでなければ全採用。
  const classAllSelected =
    classCands.some((c) => c.status !== "本登録済み") &&
    classCands.filter((c) => c.status !== "本登録済み").every((c) => c.status === "採用候補")
  const toggleAllClasses = () =>
    setClassCands((p) => {
      const sel = p.filter((c) => c.status !== "本登録済み")
      const allSel = sel.length > 0 && sel.every((c) => c.status === "採用候補")
      return p.map((c) => (c.status === "本登録済み" ? c : { ...c, status: allSel ? "確認中" : "採用候補" }))
    })

  // 採用候補のうち、始点・終点クラス（または名称）が未指定で本登録できない行。
  // 「なぜ本登録ボタンが押せないか」の説明と、行・ドロップダウンの黄色ハイライトに使う。
  const relIncompleteSelected = relCands.filter(
    (c) => c.status === "採用候補" && (!c.sourceClassId || !c.targetClassId || !c.relationName.trim()),
  )

  const relAllSelected =
    relCands.some((c) => c.status !== "本登録済み") &&
    relCands.filter((c) => c.status !== "本登録済み").every((c) => c.status === "採用候補")
  const toggleAllRelations = () =>
    setRelCands((p) => {
      const sel = p.filter((c) => c.status !== "本登録済み")
      const allSel = sel.length > 0 && sel.every((c) => c.status === "採用候補")
      return p.map((c) => (c.status === "本登録済み" ? c : { ...c, status: allSel ? "確認中" : "採用候補" }))
    })

  const instAllSelected =
    instCands.some((c) => c.status !== "本登録済み") &&
    instCands.filter((c) => c.status !== "本登録済み").every((c) => c.status === "採用候補")
  const toggleAllInstances = () =>
    setInstCands((p) => {
      const sel = p.filter((c) => c.status !== "本登録済み")
      const allSel = sel.length > 0 && sel.every((c) => c.status === "採用候補")
      return p.map((c) => (c.status === "本登録済み" ? c : { ...c, status: allSel ? "確認中" : "採用候補" }))
    })

  const hasCandidates = classCands.length > 0 || instCands.length > 0 || relCands.length > 0

  return (
    <div className="flex h-full flex-col">
      <TopBar title="オントロジー抽出" />
      <div className="flex-1 overflow-auto p-6">

        <div className="mb-6 flex items-start justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            既存文書をLLMで解析して、クラス／リレーション／インスタンスを抽出します。
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <span className="whitespace-nowrap text-sm font-medium text-foreground">解析AIモデル（LLM）選択</span>
            <Select value={selectedModel} onValueChange={(v) => { if (v) setSelectedModel(v) }} disabled={analyzing}>
              <SelectTrigger className="h-9 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODEL_OPTIONS.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">ファイル指定</CardTitle>
          </CardHeader>
          <CardContent>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.pdf"
              className="hidden"
              onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
            />
            <div className="flex items-stretch gap-4">
              {/* D&D エリア（可変・広め） */}
              <div className="min-w-0 flex-1">
                <div
                  className="flex h-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/40 px-6 py-6 text-center"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); handleFileChange(e.dataTransfer.files?.[0] ?? null) }}
                >
                  <UploadCloud className="h-7 w-7 text-muted-foreground" />
                  <p className="mt-2 text-sm text-foreground">
                    {file
                      ? <span className="inline-flex items-center gap-1.5 font-medium"><FileText className="h-4 w-4" />{file.name}</span>
                      : "ここにファイルをドラッグ＆ドロップ"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">対応形式：PDF, TXT</p>
                  <Button size="sm" variant="outline" className="mt-3 bg-transparent"
                    onClick={() => fileInputRef.current?.click()}>
                    ファイルを選択
                  </Button>
                </div>
              </div>

              {/* 解析ボタン（テキストが折り返さない幅で固定） */}
              <Button
                disabled={!file || analyzing || !currentProject}
                className="h-auto w-48 shrink-0 gap-2 self-stretch whitespace-nowrap border-0 text-base font-semibold text-white shadow-lg transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #be185d 0%, #7e22ce 50%, #4c1d95 100%)" }}
                onClick={() => handleAnalyze()}
              >
                {analyzing
                  ? <><Loader2 className="h-5 w-5 animate-spin" />解析中...</>
                  : <><Sparkles className="h-5 w-5" />LLMで解析する</>}
              </Button>
            </div>

            {analyzeError && <p className="mt-3 text-sm text-destructive">{analyzeError}</p>}
          </CardContent>
        </Card>

        {(analyzing || hasCandidates) && (
          <Card className="mt-6">
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base flex items-center gap-2">
                  解析結果
                  {!analyzing && analyzedFileName && (
                    <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
                      <FileText className="h-3.5 w-3.5" />{analyzedFileName}
                    </span>
                  )}
                  {!analyzing && analyzedModelLabel && (
                    <span className="text-xs font-normal text-muted-foreground">
                      利用モデル：{analyzedModelLabel}
                    </span>
                  )}
                </CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 shrink-0 gap-1.5 bg-transparent"
                  title="同じファイルを、現在選択中のモデルでもう一度解析します"
                  disabled={analyzing || !lastFileRef.current || !currentProject}
                  onClick={() => { if (lastFileRef.current) handleAnalyze(lastFileRef.current) }}
                >
                  {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
                  解析を再実行
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {analyzing ? (
                <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    文書を解析しています。完了すると、クラス・リレーション・インスタンスの候補が表示されます。
                  </p>
                </div>
              ) : (
              <Tabs defaultValue="classes">
                <TabsList>
                  <TabsTrigger value="classes">クラス候補<CountPill n={classCands.filter((c) => c.status !== "本登録済み").length} /></TabsTrigger>
                  <TabsTrigger value="relations">リレーション候補<CountPill n={relCands.filter((c) => c.status !== "本登録済み").length} /></TabsTrigger>
                  <TabsTrigger value="instances">インスタンス候補<CountPill n={instCands.filter((c) => c.status !== "本登録済み").length} /></TabsTrigger>
                </TabsList>

                {/* クラス候補 */}
                <TabsContent value="classes" className="mt-4">
                  {classCands.length === 0
                    ? <p className="py-4 text-center text-sm text-muted-foreground">クラス候補がありません</p>
                    : (
                      <>
                        <div className="mb-3 flex items-center gap-3">
                          <Button
                            variant="success"
                            className="gap-1.5 text-sm"
                            disabled={registeringClasses || classCands.every((c) => c.status !== "採用候補")}
                            onClick={registerSelectedClasses}
                          >
                            {registeringClasses && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            採用候補を本登録
                            {classCands.some((c) => c.status === "採用候補") &&
                              `（${classCands.filter((c) => c.status === "採用候補").length}件）`}
                          </Button>
                          <p className="text-xs text-muted-foreground">
                            チェックを付けて採用候補に選び、まとめて本登録できます。鉛筆アイコンで名称・説明を編集できます。
                          </p>
                        </div>
                        <div className="overflow-x-auto rounded-lg border border-border">
                          <Table className="table-fixed">
                            <TableHeader>
                              <TableRow className="bg-muted/50 hover:bg-muted/50">
                                <TableHead className="w-16 text-center font-semibold text-foreground">
                                  <div className="flex items-center justify-center">
                                    <SelectAllBox allSelected={classAllSelected} onToggle={toggleAllClasses} />
                                  </div>
                                </TableHead>
                                <TableHead className="w-48 font-semibold text-foreground">提案クラス名</TableHead>
                                <TableHead className="font-semibold text-foreground">説明</TableHead>
                                <TableHead className="w-56 font-semibold text-foreground">インスタンス候補</TableHead>
                                <TableHead className="w-24 font-semibold text-foreground">ステータス</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {classCands.map((c) => {
                                const registered = c.status === "本登録済み"
                                const selected = c.status === "採用候補"
                                const editing = editingClassNameId === c.id
                                return (
                                  <TableRow
                                    key={c.id}
                                    className={cn(
                                      registered && "opacity-50",
                                      selected && "bg-green-50/60 dark:bg-green-950/20",
                                    )}
                                  >
                                    <TableCell className="align-top pt-3 text-center">
                                      <button
                                        type="button"
                                        disabled={registered}
                                        aria-label="採用候補に選ぶ"
                                        onClick={() => toggleClassCandidateSelection(c.id)}
                                        className={cn(
                                          "inline-flex h-5 w-5 items-center justify-center rounded border transition-colors",
                                          selected || registered
                                            ? "border-green-600 bg-green-600 text-white"
                                            : "cursor-pointer border-input hover:border-green-500",
                                        )}
                                      >
                                        {(selected || registered) && <Check className="h-3.5 w-3.5" />}
                                      </button>
                                    </TableCell>
                                    <TableCell className="align-top whitespace-normal">
                                      <div className="flex items-start gap-1">
                                        {editing ? (
                                          <Input
                                            className="h-8 flex-1"
                                            autoFocus
                                            value={c.proposedClassName}
                                            onChange={(e) => updateClassCand(c.id, { proposedClassName: e.target.value })}
                                            onKeyDown={(e) => { if (e.key === "Enter") setEditingClassNameId(null) }}
                                          />
                                        ) : (
                                          <button
                                            type="button"
                                            disabled={registered}
                                            onClick={() => toggleClassCandidateSelection(c.id)}
                                            className={cn(
                                              "flex-1 break-words py-1 text-left text-sm font-medium",
                                              registered ? "cursor-default" : "cursor-pointer hover:text-green-700 dark:hover:text-green-400",
                                            )}
                                          >
                                            {c.proposedClassName || "（未設定）"}
                                          </button>
                                        )}
                                        {!registered && (
                                          <button
                                            type="button"
                                            className="mt-1 shrink-0 text-muted-foreground hover:text-foreground"
                                            aria-label={editing ? "編集を終了" : "名称・説明を編集"}
                                            onClick={() => setEditingClassNameId(editing ? null : c.id)}
                                          >
                                            {editing ? <Check className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                                          </button>
                                        )}
                                      </div>
                                    </TableCell>
                                    <TableCell className="align-top whitespace-normal">
                                      {editing ? (
                                        <Input
                                          className="h-8 text-sm"
                                          value={c.proposedClassDescription}
                                          onChange={(e) => updateClassCand(c.id, { proposedClassDescription: e.target.value })}
                                          onKeyDown={(e) => { if (e.key === "Enter") setEditingClassNameId(null) }}
                                        />
                                      ) : (
                                        <span className="block break-words py-1 text-sm text-muted-foreground">
                                          {c.proposedClassDescription || "-"}
                                        </span>
                                      )}
                                    </TableCell>
                                    <TableCell className="align-top whitespace-normal pt-3">
                                      <span className="block break-words text-sm text-muted-foreground">
                                        {c.instanceNames.join("、")}
                                      </span>
                                    </TableCell>
                                    <TableCell className="align-top pt-3">
                                      <StatusBadge status={c.status} />
                                    </TableCell>
                                  </TableRow>
                                )
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      </>
                    )}
                </TabsContent>

                {/* リレーション候補 */}
                <TabsContent value="relations" className="mt-4">
                  {relCands.length === 0
                    ? <p className="py-4 text-center text-sm text-muted-foreground">リレーション候補がありません</p>
                    : (
                      <>
                        <div className="mb-3 flex items-center gap-3">
                          <Button
                            variant="success"
                            className="gap-1.5 text-sm"
                            disabled={
                              registeringRelations ||
                              !relCands.some((c) => c.status === "採用候補") ||
                              relCands
                                .filter((c) => c.status === "採用候補")
                                .some((c) => !c.sourceClassId || !c.targetClassId || !c.relationName.trim())
                            }
                            onClick={registerSelectedRelations}
                          >
                            {registeringRelations && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            採用候補を本登録
                            {relCands.some((c) => c.status === "採用候補") &&
                              `（${relCands.filter((c) => c.status === "採用候補").length}件）`}
                          </Button>
                          <p className="text-xs text-muted-foreground">
                            チェックを付けて採用候補に選び、始点・終点クラスを確定してまとめて本登録できます。鉛筆アイコンで名称・説明を編集できます。
                          </p>
                        </div>
                        {relIncompleteSelected.length > 0 && (
                          <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span>
                              採用候補のうち {relIncompleteSelected.length} 件は始点・終点クラス（または名称）が未指定のため本登録できません。
                              <span className="font-medium">黄色の行</span>の未指定項目（黄色で強調されたドロップダウン）を指定してください。
                            </span>
                          </div>
                        )}
                        <div className="overflow-x-auto rounded-lg border border-border">
                          <Table className="table-fixed">
                            <TableHeader>
                              <TableRow className="bg-muted/50 hover:bg-muted/50">
                                <TableHead className="w-16 text-center font-semibold text-foreground">
                                  <div className="flex items-center justify-center">
                                    <SelectAllBox allSelected={relAllSelected} onToggle={toggleAllRelations} />
                                  </div>
                                </TableHead>
                                <TableHead className="w-44 font-semibold text-foreground">提案リレーション名</TableHead>
                                <TableHead className="font-semibold text-foreground">説明</TableHead>
                                <TableHead className="w-36 font-semibold text-foreground">始点クラス</TableHead>
                                <TableHead className="w-36 font-semibold text-foreground">終点クラス</TableHead>
                                <TableHead className="w-24 font-semibold text-foreground">ステータス</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {relCands.map((c) => {
                                const registered = c.status === "本登録済み"
                                const selected = c.status === "採用候補"
                                const editing = editingRelationNameId === c.id
                                // 採用候補なのに始点/終点クラスが未指定＝本登録できない行。黄色で強調する。
                                const needSource = selected && !c.sourceClassId
                                const needTarget = selected && !c.targetClassId
                                const incomplete = needSource || needTarget
                                return (
                                  <TableRow
                                    key={c.id}
                                    className={cn(
                                      registered && "opacity-50",
                                      selected && !incomplete && "bg-green-50/60 dark:bg-green-950/20",
                                      selected && incomplete && "bg-amber-50/70 dark:bg-amber-950/25",
                                    )}
                                  >
                                    <TableCell className="align-top pt-3 text-center">
                                      <button
                                        type="button"
                                        disabled={registered}
                                        aria-label="採用候補に選ぶ"
                                        onClick={() => toggleRelCandidateSelection(c.id)}
                                        className={cn(
                                          "inline-flex h-5 w-5 items-center justify-center rounded border transition-colors",
                                          selected || registered
                                            ? "border-green-600 bg-green-600 text-white"
                                            : "cursor-pointer border-input hover:border-green-500",
                                        )}
                                      >
                                        {(selected || registered) && <Check className="h-3.5 w-3.5" />}
                                      </button>
                                    </TableCell>
                                    <TableCell className="align-top whitespace-normal">
                                      <div className="flex items-start gap-1">
                                        {editing ? (
                                          <Input
                                            className="h-8 flex-1"
                                            autoFocus
                                            value={c.relationName}
                                            onChange={(e) => updateRel(c.id, { relationName: e.target.value })}
                                            onKeyDown={(e) => { if (e.key === "Enter") setEditingRelationNameId(null) }}
                                          />
                                        ) : (
                                          <button
                                            type="button"
                                            disabled={registered}
                                            onClick={() => toggleRelCandidateSelection(c.id)}
                                            className={cn(
                                              "flex-1 break-words py-1 text-left text-sm font-medium",
                                              registered ? "cursor-default" : "cursor-pointer hover:text-green-700 dark:hover:text-green-400",
                                            )}
                                          >
                                            {c.relationName || "（未設定）"}
                                          </button>
                                        )}
                                        {!registered && (
                                          <button
                                            type="button"
                                            className="mt-1 shrink-0 text-muted-foreground hover:text-foreground"
                                            aria-label={editing ? "編集を終了" : "名称・説明を編集"}
                                            onClick={() => setEditingRelationNameId(editing ? null : c.id)}
                                          >
                                            {editing ? <Check className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                                          </button>
                                        )}
                                      </div>
                                    </TableCell>
                                    <TableCell className="align-top whitespace-normal">
                                      {editing ? (
                                        <Input
                                          className="h-8 text-sm"
                                          value={c.description}
                                          onChange={(e) => updateRel(c.id, { description: e.target.value })}
                                          onKeyDown={(e) => { if (e.key === "Enter") setEditingRelationNameId(null) }}
                                        />
                                      ) : (
                                        <span className="block break-words py-1 text-sm text-muted-foreground">
                                          {c.description || "-"}
                                        </span>
                                      )}
                                    </TableCell>
                                    <TableCell className="align-top">
                                      <Select value={c.sourceClassId ?? "__none__"} disabled={registered}
                                        onValueChange={(v) => {
                                          const cls = v === "__none__" ? null : classes.find((x) => x.id === v)
                                          updateRel(c.id, {
                                            sourceClassId: v === "__none__" ? null : v,
                                            sourceClassName: cls?.name ?? "",
                                            // 始点・終点クラスを自分で選んだら自動で採用候補にする
                                            ...(v !== "__none__" ? { status: "採用候補" as CandidateStatus } : {}),
                                          })
                                        }}>
                                        <SelectTrigger className={cn("h-8 w-full", needSource && "border-amber-400 text-amber-700 ring-1 ring-amber-400/50 dark:border-amber-600 dark:text-amber-300")}>
                                          <SelectValue>{c.sourceClassId ? c.sourceClassName : (needSource ? "要選択" : "選択")}</SelectValue>
                                        </SelectTrigger>
                                        <SelectContent className="max-h-72">
                                          <SelectItem value="__none__">選択</SelectItem>
                                          {classes.map((cls) => <SelectItem key={cls.id} value={cls.id}>{cls.name}</SelectItem>)}
                                        </SelectContent>
                                      </Select>
                                    </TableCell>
                                    <TableCell className="align-top">
                                      <Select value={c.targetClassId ?? "__none__"} disabled={registered}
                                        onValueChange={(v) => {
                                          const cls = v === "__none__" ? null : classes.find((x) => x.id === v)
                                          updateRel(c.id, {
                                            targetClassId: v === "__none__" ? null : v,
                                            targetClassName: cls?.name ?? "",
                                            // 始点・終点クラスを自分で選んだら自動で採用候補にする
                                            ...(v !== "__none__" ? { status: "採用候補" as CandidateStatus } : {}),
                                          })
                                        }}>
                                        <SelectTrigger className={cn("h-8 w-full", needTarget && "border-amber-400 text-amber-700 ring-1 ring-amber-400/50 dark:border-amber-600 dark:text-amber-300")}>
                                          <SelectValue>{c.targetClassId ? c.targetClassName : (needTarget ? "要選択" : "選択")}</SelectValue>
                                        </SelectTrigger>
                                        <SelectContent className="max-h-72">
                                          <SelectItem value="__none__">選択</SelectItem>
                                          {classes.map((cls) => <SelectItem key={cls.id} value={cls.id}>{cls.name}</SelectItem>)}
                                        </SelectContent>
                                      </Select>
                                    </TableCell>
                                    <TableCell className="align-top pt-3">
                                      <StatusBadge status={c.status} />
                                    </TableCell>
                                  </TableRow>
                                )
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      </>
                    )}
                </TabsContent>

                {/* インスタンス候補 */}
                <TabsContent value="instances" className="mt-4">
                  {instCands.length === 0
                    ? <p className="py-4 text-center text-sm text-muted-foreground">インスタンス候補がありません</p>
                    : (
                      <>
                        <div className="mb-3 flex items-center gap-3">
                          <Button
                            variant="success"
                            className="gap-1.5 text-sm"
                            disabled={
                              registeringInstances ||
                              !instCands.some((c) => c.status === "採用候補") ||
                              instCands
                                .filter((c) => c.status === "採用候補")
                                .some((c) => !c.classId)
                            }
                            onClick={registerSelectedInstances}
                          >
                            {registeringInstances && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            採用候補を本登録
                            {instCands.some((c) => c.status === "採用候補") &&
                              `（${instCands.filter((c) => c.status === "採用候補").length}件）`}
                          </Button>
                          <p className="text-xs text-muted-foreground">
                            チェックを付けて採用候補に選び、まとめて本登録できます。鉛筆アイコンで名称を編集できます。所属クラスが「クラス未登録」のものは、クラス候補タブで本登録するか既存クラスを選ぶまで本登録できません。
                          </p>
                        </div>
                        <div className="overflow-x-auto rounded-lg border border-border">
                          <Table className="table-fixed">
                            <TableHeader>
                              <TableRow className="bg-muted/50 hover:bg-muted/50">
                                <TableHead className="w-16 text-center font-semibold text-foreground">
                                  <div className="flex items-center justify-center">
                                    <SelectAllBox allSelected={instAllSelected} onToggle={toggleAllInstances} />
                                  </div>
                                </TableHead>
                                <TableHead className="w-48 font-semibold text-foreground">提案インスタンス名</TableHead>
                                <TableHead className="w-56 font-semibold text-foreground">所属クラス</TableHead>
                                <TableHead className="font-semibold text-foreground">提案所属クラス</TableHead>
                                <TableHead className="w-24 font-semibold text-foreground">ステータス</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {instCands.map((c) => {
                                const registered = c.status === "本登録済み"
                                const selected = c.status === "採用候補"
                                const editing = editingInstanceNameId === c.id
                                return (
                                  <TableRow
                                    key={c.id}
                                    className={cn(
                                      registered && "opacity-50",
                                      selected && "bg-green-50/60 dark:bg-green-950/20",
                                    )}
                                  >
                                    <TableCell className="align-top pt-3 text-center">
                                      <button
                                        type="button"
                                        disabled={registered}
                                        aria-label="採用候補に選ぶ"
                                        onClick={() => toggleInstCandidateSelection(c.id)}
                                        className={cn(
                                          "inline-flex h-5 w-5 items-center justify-center rounded border transition-colors",
                                          selected || registered
                                            ? "border-green-600 bg-green-600 text-white"
                                            : "cursor-pointer border-input hover:border-green-500",
                                        )}
                                      >
                                        {(selected || registered) && <Check className="h-3.5 w-3.5" />}
                                      </button>
                                    </TableCell>
                                    <TableCell className="align-top whitespace-normal">
                                      <div className="flex items-start gap-1">
                                        {editing ? (
                                          <Input
                                            className="h-8 flex-1"
                                            autoFocus
                                            value={c.name}
                                            onChange={(e) => updateInst(c.id, { name: e.target.value })}
                                            onKeyDown={(e) => { if (e.key === "Enter") setEditingInstanceNameId(null) }}
                                          />
                                        ) : (
                                          <button
                                            type="button"
                                            disabled={registered}
                                            onClick={() => toggleInstCandidateSelection(c.id)}
                                            className={cn(
                                              "flex-1 break-words py-1 text-left text-sm font-medium",
                                              registered ? "cursor-default" : "cursor-pointer hover:text-green-700 dark:hover:text-green-400",
                                            )}
                                          >
                                            {c.name || "（未設定）"}
                                          </button>
                                        )}
                                        {!registered && (
                                          <button
                                            type="button"
                                            className="mt-1 shrink-0 text-muted-foreground hover:text-foreground"
                                            aria-label={editing ? "編集を終了" : "インスタンス名を編集"}
                                            onClick={() => setEditingInstanceNameId(editing ? null : c.id)}
                                          >
                                            {editing ? <Check className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                                          </button>
                                        )}
                                      </div>
                                    </TableCell>
                                    <TableCell className="align-top">
                                      <Select value={c.classId ?? "__none__"} disabled={registered}
                                        onValueChange={(v) => {
                                          if (v === "__none__") { updateInst(c.id, { classId: null, className: "" }) }
                                          else {
                                            const cls = classes.find((x) => x.id === v)
                                            updateInst(c.id, { classId: v, className: cls?.name ?? "" })
                                          }
                                        }}>
                                        <SelectTrigger className="h-8 w-full">
                                          <SelectValue>{c.classId ? c.className : "既存クラスから選択"}</SelectValue>
                                        </SelectTrigger>
                                        <SelectContent className="max-h-72">
                                          <SelectItem value="__none__">既存クラスから選択</SelectItem>
                                          {classes.map((cls) => <SelectItem key={cls.id} value={cls.id}>{cls.name}</SelectItem>)}
                                        </SelectContent>
                                      </Select>
                                    </TableCell>
                                    <TableCell className="align-top whitespace-normal pt-3">
                                      {c.pendingClassCandidateId ? (
                                        <div className="flex items-start gap-1.5">
                                          <span className="inline-block shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                                            クラス未登録
                                          </span>
                                          <span className="break-words text-sm text-muted-foreground">{c.proposedClassName}</span>
                                        </div>
                                      ) : (
                                        <span className="block break-words text-sm text-muted-foreground">{c.proposedClassName || "-"}</span>
                                      )}
                                    </TableCell>
                                    <TableCell className="align-top pt-3">
                                      <StatusBadge status={c.status} />
                                    </TableCell>
                                  </TableRow>
                                )
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      </>
                    )}
                </TabsContent>

              </Tabs>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
