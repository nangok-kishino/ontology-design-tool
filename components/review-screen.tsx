"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
import { Tooltip } from "@/components/ui/tooltip"
import { TopBar } from "@/components/top-bar"
import { useProject } from "@/app/project-context"
import type { OntologyClass, OntologyRelation } from "@/lib/types"
import { UploadCloud, FileText, Check, Sparkles, Loader2, Pencil } from "lucide-react"

type CandidateStatus = "確認中" | "新規追加" | "統合済み" | "承認済み" | "却下" | "採用候補" | "本登録済み"

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
  candidateType: "new" | "merge"
  existingInstanceId: string | null
  existingInstanceName: string
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
    確認中: "bg-muted text-muted-foreground",
    新規追加: "bg-emerald-100 text-emerald-700",
    統合済み: "bg-blue-100 text-blue-700",
    承認済み: "bg-emerald-100 text-emerald-700",
    却下: "bg-red-100 text-red-700",
    採用候補: "bg-indigo-100 text-indigo-700",
    本登録済み: "bg-slate-200 text-slate-600",
  }
  return <Badge className={`font-normal ${map[status]}`}>{status}</Badge>
}

function CountPill({ n }: { n: number }) {
  return (
    <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
      {n}
    </span>
  )
}

export function ReviewScreen() {
  const { currentProject } = useProject()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [analyzedFileName, setAnalyzedFileName] = useState<string | null>(null)

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

  useEffect(() => {
    if (!currentProject) return

    // プロジェクトが切り替わったら解析結果はクリアする
    setFile(null)
    setAnalyzeError(null)
    setAnalyzedFileName(null)
    setClassCands([])
    setInstCands([])
    setRelCands([])
    setEditingClassNameId(null)
    setEditingRelationNameId(null)

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

  const handleAnalyze = async () => {
    if (!file || !currentProject) return
    setAnalyzing(true)
    setAnalyzeError(null)
    setClassCands([])
    setInstCands([])
    setRelCands([])
    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("projectId", currentProject.id)
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

      // 既存クラスに割当済み・統合候補 → インスタンス候補タブへ
      const resolvedInstCands: InstanceCandidate[] = allInst
        .filter((i) => !i.isNewClass || !!i.classId)
        .map((i) => ({
          id: i.id,
          name: i.name,
          classId: i.classId ?? null,
          className: i.className ?? "",
          proposedClassName: i.className || i.suggestedClassName || "",
          candidateType: i.candidateType ?? "new",
          existingInstanceId: i.existingInstanceId ?? null,
          existingInstanceName: i.existingInstanceName ?? "",
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
          candidateType: i.candidateType ?? "new",
          existingInstanceId: i.existingInstanceId ?? null,
          existingInstanceName: i.existingInstanceName ?? "",
          pendingClassCandidateId: classCandIdByName.get((i.newClassName ?? "").trim()),
          status: "確認中" as CandidateStatus,
          saving: false,
        }))

      setInstCands([...resolvedInstCands, ...pendingInstCands])

      setRelCands(Array.isArray(data.relations) ? data.relations : [])

      // 解析成功後、ファイル指定エリアをクリアして解析結果側に表示を切り替える
      setAnalyzedFileName(file.name)
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
        if (c.id !== id || c.status === "本登録済み" || c.status === "統合済み") return c
        return { ...c, status: c.status === "採用候補" ? "確認中" : "採用候補" }
      })
    )
  }

  // 採用候補となっているインスタンスをまとめて本登録（統合候補は統合済みにする）
  const registerSelectedInstances = async () => {
    if (!currentProject) return
    const targets = instCands.filter((c) => c.status === "採用候補")
    if (targets.length === 0) return
    setRegisteringInstances(true)
    try {
      for (const cand of targets) {
        if (cand.candidateType === "merge") {
          updateInst(cand.id, { status: "統合済み" })
          continue
        }
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

        <p className="mb-6 text-sm text-muted-foreground">
          既存文書をLLMで解析して、クラス／リレーション／インスタンスを抽出します。
          <br />
          LLMにはGoogleの「Gemini 2.5 Pro」を利用しています。
        </p>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">ファイル指定</CardTitle>
          </CardHeader>
          <CardContent>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.pdf"
              className="hidden"
              onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
            />
            <div
              className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/40 px-6 py-10 text-center"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); handleFileChange(e.dataTransfer.files?.[0] ?? null) }}
            >
              <UploadCloud className="h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm text-foreground">
                {file
                  ? <span className="inline-flex items-center gap-1.5 font-medium"><FileText className="h-4 w-4" />{file.name}</span>
                  : "ここにファイルをドラッグ＆ドロップ"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">対応形式：PDF, TXT</p>
              <Button size="sm" variant="outline" className="mt-4 bg-transparent"
                onClick={() => fileInputRef.current?.click()}>
                ファイルを選択
              </Button>
            </div>

            {analyzeError && <p className="mt-3 text-sm text-destructive">{analyzeError}</p>}

            <div className="mt-6">
              <Button
                disabled={!file || analyzing || !currentProject}
                className="w-full h-12 gap-3 text-base font-semibold text-white border-0 shadow-lg hover:opacity-90 transition-opacity disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #be185d 0%, #7e22ce 50%, #4c1d95 100%)" }}
                onClick={handleAnalyze}
              >
                {analyzing
                  ? <><Loader2 className="h-5 w-5 animate-spin" />解析中...</>
                  : <><Sparkles className="h-5 w-5" />LLMで解析する</>}
              </Button>
            </div>
          </CardContent>
        </Card>

        {hasCandidates && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                解析結果
                {analyzedFileName && (
                  <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
                    <FileText className="h-3.5 w-3.5" />{analyzedFileName}
                  </span>
                )}
              </CardTitle>
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
                        <div className="mb-3 flex items-center justify-between">
                          <p className="text-xs text-muted-foreground">
                            クラス名をクリックして採用候補に選び、まとめて本登録できます。
                          </p>
                          <Button
                            className="gap-1.5 text-sm bg-indigo-600 text-white hover:bg-indigo-700 border-indigo-600"
                            disabled={registeringClasses || classCands.every((c) => c.status !== "採用候補")}
                            onClick={registerSelectedClasses}
                          >
                            {registeringClasses && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            採用候補を本登録
                            {classCands.some((c) => c.status === "採用候補") &&
                              `（${classCands.filter((c) => c.status === "採用候補").length}件）`}
                          </Button>
                        </div>
                        <div className="rounded-lg border border-border">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-48">提案クラス名</TableHead>
                                <TableHead>説明</TableHead>
                                <TableHead className="w-36">インスタンス候補</TableHead>
                                <TableHead className="w-24">ステータス</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {classCands.map((c) => {
                                const registered = c.status === "本登録済み"
                                return (
                                  <TableRow key={c.id} className={registered ? "opacity-50" : ""}>
                                    <TableCell className="align-top">
                                      {editingClassNameId === c.id ? (
                                        <Input
                                          className="h-8"
                                          autoFocus
                                          value={c.proposedClassName}
                                          onChange={(e) => updateClassCand(c.id, { proposedClassName: e.target.value })}
                                          onBlur={() => setEditingClassNameId(null)}
                                          onKeyDown={(e) => { if (e.key === "Enter") setEditingClassNameId(null) }}
                                        />
                                      ) : (
                                        <div className="flex items-center gap-1">
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant={registered ? "secondary" : "outline"}
                                            className={
                                              c.status === "採用候補"
                                                ? "h-8 grow justify-start gap-1.5 font-normal border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700 hover:text-white"
                                                : registered
                                                ? "h-8 grow justify-start gap-1.5 font-normal"
                                                : "h-8 grow justify-start gap-1.5 font-normal hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
                                            }
                                            disabled={registered}
                                            onClick={() => toggleClassCandidateSelection(c.id)}
                                          >
                                            {c.status === "採用候補" && <Check className="h-3.5 w-3.5" />}
                                            {c.proposedClassName || "（未設定）"}
                                          </Button>
                                          {!registered && (
                                            <button
                                              type="button"
                                              className="shrink-0 text-muted-foreground hover:text-foreground"
                                              aria-label="クラス名を編集"
                                              onClick={() => setEditingClassNameId(c.id)}
                                            >
                                              <Pencil className="h-3.5 w-3.5" />
                                            </button>
                                          )}
                                        </div>
                                      )}
                                    </TableCell>
                                    <TableCell className="align-top">
                                      <Input className="h-8 text-sm" value={c.proposedClassDescription}
                                        disabled={registered}
                                        onChange={(e) => updateClassCand(c.id, { proposedClassDescription: e.target.value })} />
                                    </TableCell>
                                    <TableCell className="align-top pt-2">
                                      <Tooltip content={c.instanceNames.join("、")}>
                                        <span className="block w-32 truncate text-sm text-muted-foreground">
                                          {c.instanceNames.join("、")}
                                        </span>
                                      </Tooltip>
                                    </TableCell>
                                    <TableCell className="align-top pt-2">
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
                        <div className="mb-3 flex items-center justify-between">
                          <p className="text-xs text-muted-foreground">
                            リレーション名をクリックして採用候補に選び、始点・終点クラスを確定してから本登録できます。
                            <br />
                            本登録されていないクラスは、始点・終点クラスとして指定できません。
                          </p>
                          <Button
                            className="gap-1.5 text-sm bg-indigo-600 text-white hover:bg-indigo-700 border-indigo-600"
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
                        </div>
                        <div className="rounded-lg border border-border">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-44">提案リレーション名</TableHead>
                                <TableHead>説明</TableHead>
                                <TableHead className="w-40">始点クラス</TableHead>
                                <TableHead className="w-40">終点クラス</TableHead>
                                <TableHead className="w-24">ステータス</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {relCands.map((c) => {
                                const registered = c.status === "本登録済み"
                                const selected = c.status === "採用候補"
                                return (
                                  <TableRow key={c.id} className={registered ? "opacity-50" : ""}>
                                    <TableCell className="align-top">
                                      {editingRelationNameId === c.id ? (
                                        <Input
                                          className="h-8"
                                          autoFocus
                                          value={c.relationName}
                                          onChange={(e) => updateRel(c.id, { relationName: e.target.value })}
                                          onBlur={() => setEditingRelationNameId(null)}
                                          onKeyDown={(e) => { if (e.key === "Enter") setEditingRelationNameId(null) }}
                                        />
                                      ) : (
                                        <div className="flex items-center gap-1">
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant={registered ? "secondary" : "outline"}
                                            className={
                                              selected
                                                ? "h-8 grow justify-start gap-1.5 font-normal border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700 hover:text-white"
                                                : registered
                                                ? "h-8 grow justify-start gap-1.5 font-normal"
                                                : "h-8 grow justify-start gap-1.5 font-normal hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
                                            }
                                            disabled={registered}
                                            onClick={() => toggleRelCandidateSelection(c.id)}
                                          >
                                            {selected && <Check className="h-3.5 w-3.5" />}
                                            {c.relationName || "（未設定）"}
                                          </Button>
                                          {!registered && (
                                            <button
                                              type="button"
                                              className="shrink-0 text-muted-foreground hover:text-foreground"
                                              aria-label="リレーション名を編集"
                                              onClick={() => setEditingRelationNameId(c.id)}
                                            >
                                              <Pencil className="h-3.5 w-3.5" />
                                            </button>
                                          )}
                                        </div>
                                      )}
                                    </TableCell>
                                    <TableCell className="align-top">
                                      <Input className="h-8 text-sm" value={c.description}
                                        disabled={registered}
                                        onChange={(e) => updateRel(c.id, { description: e.target.value })} />
                                    </TableCell>
                                    <TableCell className="align-top">
                                      {selected || registered ? (
                                        <Select value={c.sourceClassId ?? "__none__"} disabled={registered}
                                          onValueChange={(v) => {
                                            const cls = v === "__none__" ? null : classes.find((x) => x.id === v)
                                            updateRel(c.id, { sourceClassId: v === "__none__" ? null : v, sourceClassName: cls?.name ?? "" })
                                          }}>
                                          <SelectTrigger className="h-8">
                                            <SelectValue>{c.sourceClassId ? c.sourceClassName : "選択"}</SelectValue>
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="__none__">選択</SelectItem>
                                            {classes.map((cls) => <SelectItem key={cls.id} value={cls.id}>{cls.name}</SelectItem>)}
                                          </SelectContent>
                                        </Select>
                                      ) : (
                                        <span className="text-sm text-muted-foreground">{c.sourceClassName || "未設定"}</span>
                                      )}
                                    </TableCell>
                                    <TableCell className="align-top">
                                      {selected || registered ? (
                                        <Select value={c.targetClassId ?? "__none__"} disabled={registered}
                                          onValueChange={(v) => {
                                            const cls = v === "__none__" ? null : classes.find((x) => x.id === v)
                                            updateRel(c.id, { targetClassId: v === "__none__" ? null : v, targetClassName: cls?.name ?? "" })
                                          }}>
                                          <SelectTrigger className="h-8">
                                            <SelectValue>{c.targetClassId ? c.targetClassName : "選択"}</SelectValue>
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="__none__">選択</SelectItem>
                                            {classes.map((cls) => <SelectItem key={cls.id} value={cls.id}>{cls.name}</SelectItem>)}
                                          </SelectContent>
                                        </Select>
                                      ) : (
                                        <span className="text-sm text-muted-foreground">{c.targetClassName || "未設定"}</span>
                                      )}
                                    </TableCell>
                                    <TableCell className="align-top pt-2">
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
                        <div className="mb-3 flex items-center justify-between">
                          <p className="text-xs text-muted-foreground">
                            インスタンス名をクリックして採用候補に選び、まとめて本登録できます。
                            <br />
                            提案所属クラスが「クラス未登録」の場合、そのクラスをクラス候補タブで本登録するか、所属クラスに既存クラスを選び直すまでは本登録できません。
                          </p>
                          <Button
                            className="gap-1.5 text-sm bg-indigo-600 text-white hover:bg-indigo-700 border-indigo-600"
                            disabled={
                              registeringInstances ||
                              !instCands.some((c) => c.status === "採用候補") ||
                              instCands
                                .filter((c) => c.status === "採用候補" && c.candidateType !== "merge")
                                .some((c) => !c.classId)
                            }
                            onClick={registerSelectedInstances}
                          >
                            {registeringInstances && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            採用候補を本登録
                            {instCands.some((c) => c.status === "採用候補") &&
                              `（${instCands.filter((c) => c.status === "採用候補").length}件）`}
                          </Button>
                        </div>
                        <div className="rounded-lg border border-border">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-44">提案インスタンス名</TableHead>
                                <TableHead className="w-56">所属クラス</TableHead>
                                <TableHead className="w-44">提案所属クラス</TableHead>
                                <TableHead className="w-24">ステータス</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {instCands.map((c) => {
                                const registered = c.status === "本登録済み" || c.status === "統合済み"
                                const selected = c.status === "採用候補"
                                return (
                                  <TableRow key={c.id} className={registered ? "opacity-50" : ""}>
                                    <TableCell className="align-top">
                                      {editingInstanceNameId === c.id ? (
                                        <Input
                                          className="h-8"
                                          autoFocus
                                          value={c.name}
                                          onChange={(e) => updateInst(c.id, { name: e.target.value })}
                                          onBlur={() => setEditingInstanceNameId(null)}
                                          onKeyDown={(e) => { if (e.key === "Enter") setEditingInstanceNameId(null) }}
                                        />
                                      ) : (
                                        <div className="flex items-center gap-1">
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant={registered ? "secondary" : "outline"}
                                            className={
                                              selected
                                                ? "h-8 grow justify-start gap-1.5 font-normal border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700 hover:text-white"
                                                : registered
                                                ? "h-8 grow justify-start gap-1.5 font-normal"
                                                : "h-8 grow justify-start gap-1.5 font-normal hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
                                            }
                                            disabled={registered}
                                            onClick={() => toggleInstCandidateSelection(c.id)}
                                          >
                                            {selected && <Check className="h-3.5 w-3.5" />}
                                            {c.name || "（未設定）"}
                                          </Button>
                                          {!registered && (
                                            <button
                                              type="button"
                                              className="shrink-0 text-muted-foreground hover:text-foreground"
                                              aria-label="インスタンス名を編集"
                                              onClick={() => setEditingInstanceNameId(c.id)}
                                            >
                                              <Pencil className="h-3.5 w-3.5" />
                                            </button>
                                          )}
                                        </div>
                                      )}
                                    </TableCell>
                                    <TableCell className="align-top">
                                      {c.candidateType === "merge" ? (
                                        <div className="space-y-1">
                                          <div className="flex items-center gap-1.5">
                                            <Badge className="bg-blue-100 text-blue-700 font-normal text-xs">統合候補</Badge>
                                            <span className="text-sm font-medium text-foreground">{c.existingInstanceName}</span>
                                          </div>
                                          <p className="text-xs text-muted-foreground">既存インスタンスとの統合が提案されています</p>
                                        </div>
                                      ) : (
                                        <Select value={c.classId ?? "__none__"} disabled={registered}
                                          onValueChange={(v) => {
                                            if (v === "__none__") { updateInst(c.id, { classId: null, className: "" }) }
                                            else {
                                              const cls = classes.find((x) => x.id === v)
                                              updateInst(c.id, { classId: v, className: cls?.name ?? "" })
                                            }
                                          }}>
                                          <SelectTrigger className="h-8 w-52">
                                            <SelectValue>{c.classId ? c.className : "既存クラスから選択"}</SelectValue>
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="__none__">既存クラスから選択</SelectItem>
                                            {classes.map((cls) => <SelectItem key={cls.id} value={cls.id}>{cls.name}</SelectItem>)}
                                          </SelectContent>
                                        </Select>
                                      )}
                                    </TableCell>
                                    <TableCell className="align-top pt-2">
                                      {c.pendingClassCandidateId ? (
                                        <div className="flex items-center gap-1.5">
                                          <Badge className="bg-slate-200 text-slate-600 font-normal text-xs">クラス未登録</Badge>
                                          <span className="text-sm text-muted-foreground">{c.proposedClassName}</span>
                                        </div>
                                      ) : (
                                        <span className="text-sm text-muted-foreground">{c.proposedClassName || "-"}</span>
                                      )}
                                    </TableCell>
                                    <TableCell className="align-top pt-2">
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
