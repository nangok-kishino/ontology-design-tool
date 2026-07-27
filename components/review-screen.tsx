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
import { UploadCloud, FileText, Check, Sparkles, Loader2, Pencil, RotateCw } from "lucide-react"

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

export function ReviewScreen({ active }: { active?: boolean }) {
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

  // この画面が表示状態になったらクラス・リレーションを再取得する
  // （他画面でのクラス追加を始点・終点クラスの選択肢へ即時反映するため）
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

  const handleAnalyze = async (reuseFile?: File) => {
    const target = reuseFile ?? file
    if (!target || !currentProject) return
    setAnalyzing(true)
    setAnalyzeError(null)
    // 解析中も直前の結果は残しておき、成功時に差し替える（再実行の比較・スピナー表示のため）
    try {
      const fd = new FormData()
      fd.append("file", target)
      fd.append("projectId", currentProject.id)
      fd.append("model", selectedModel)
      const res = await fetch("/api/analyze", { method: "POST", body: fd })
      const data = await res.json()
      if (!res.ok) { setAnalyzeError(data.error ?? "解析に失敗しました"); return }

      const allInst: any[] = Array.isArray(data.instances) ? data.instances : []

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

      // 既存クラスに割当済み → インスタンス候補タブへ
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

      // クラス候補（未登録）に紐づくインスタンス候補 → 参照用にインスタンス候補タブへも表示（クラスが本登録されるまでは登録不可）
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

      // リレーション候補：始点・終点・名称が一致する重複を除去する（特にGeminiで重複が出やすい）
      const rawRels: any[] = Array.isArray(data.relations) ? data.relations : []
      const seenRel = new Set<string>()
      const dedupedRels = rawRels.filter((r) => {
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

      // 解析成功後、ファイル指定エリアをクリアして解析結果側に表示を切り替える
      lastFileRef.current = target
      setAnalyzedFileName(target.name)
      setAnalyzedModelLabel(MODEL_OPTIONS.find((m) => m.id === selectedModel)?.label ?? selectedModel)
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ""
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
          await fetch("/api/instances", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: currentProject.id, name: cand.name, classId: cand.classId }),
          })
          updateInst(cand.id, { status: "本登録済み", saving: false })
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

  const hasCandidates = classCands.length > 0 || instCands.length > 0 || relCands.length > 0

  return (
    <div className="flex h-full flex-col">
      <TopBar title="文書取込み" />
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

        {hasCandidates && (
          <Card className="mt-6">
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base flex items-center gap-2">
                  解析結果
                  {analyzedFileName && (
                    <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
                      <FileText className="h-3.5 w-3.5" />{analyzedFileName}
                    </span>
                  )}
                  {analyzedModelLabel && (
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
              <Tabs defaultValue="classes">
                <TabsList>
                  <TabsTrigger value="classes">クラス候補<CountPill n={classCands.length} /></TabsTrigger>
                  <TabsTrigger value="relations">リレーション候補<CountPill n={relCands.length} /></TabsTrigger>
                  <TabsTrigger value="instances">インスタンス候補<CountPill n={instCands.length} /></TabsTrigger>
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
                                <TableHead className="w-16 text-center font-semibold text-foreground">採用</TableHead>
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
                        <div className="overflow-x-auto rounded-lg border border-border">
                          <Table className="table-fixed">
                            <TableHeader>
                              <TableRow className="bg-muted/50 hover:bg-muted/50">
                                <TableHead className="w-16 text-center font-semibold text-foreground">採用</TableHead>
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
                                        <SelectTrigger className="h-8 w-full">
                                          <SelectValue>{c.sourceClassId ? c.sourceClassName : "選択"}</SelectValue>
                                        </SelectTrigger>
                                        <SelectContent className="max-h-72 w-auto min-w-(--anchor-width) max-w-[22rem]">
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
                                        <SelectTrigger className="h-8 w-full">
                                          <SelectValue>{c.targetClassId ? c.targetClassName : "選択"}</SelectValue>
                                        </SelectTrigger>
                                        <SelectContent className="max-h-72 w-auto min-w-(--anchor-width) max-w-[22rem]">
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
                                <TableHead className="w-16 text-center font-semibold text-foreground">採用</TableHead>
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
                                        <SelectContent className="max-h-72 w-auto min-w-(--anchor-width) max-w-[22rem]">
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
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
