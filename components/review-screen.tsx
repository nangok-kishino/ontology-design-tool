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
import { TopBar } from "@/components/top-bar"
import { useProject } from "@/app/project-context"
import type { OntologyClass, OntologyRelation } from "@/lib/types"
import { UploadCloud, FileText, Check, X, Sparkles, Loader2 } from "lucide-react"

type CandidateStatus = "確認中" | "新規追加" | "統合済み" | "承認済み" | "却下"

type ClassCandidate = {
  id: string
  instanceName: string
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
  candidateType: "new" | "merge"
  existingInstanceId: string | null
  existingInstanceName: string
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

  const [classCands, setClassCands] = useState<ClassCandidate[]>([])
  const [instCands, setInstCands] = useState<InstanceCandidate[]>([])
  const [relCands, setRelCands] = useState<RelationCandidate[]>([])
  const [classes, setClasses] = useState<OntologyClass[]>([])
  const [existingRelations, setExistingRelations] = useState<OntologyRelation[]>([])

  useEffect(() => {
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

      // isNewClass=true かつ classId なし → クラス候補タブへ
      setClassCands(
        allInst
          .filter((i) => i.isNewClass && !i.classId)
          .map((i) => ({
            id: i.id,
            instanceName: i.name,
            proposedClassName: i.newClassName ?? "",
            proposedClassDescription: i.newClassDescription ?? "",
            status: "確認中" as CandidateStatus,
            saving: false,
          }))
      )

      // それ以外 → インスタンス候補タブへ
      setInstCands(
        allInst
          .filter((i) => !i.isNewClass || !!i.classId)
          .map((i) => ({
            id: i.id,
            name: i.name,
            classId: i.classId ?? null,
            className: i.className ?? "",
            candidateType: i.candidateType ?? "new",
            existingInstanceId: i.existingInstanceId ?? null,
            existingInstanceName: i.existingInstanceName ?? "",
            status: "確認中" as CandidateStatus,
            saving: false,
          }))
      )

      setRelCands(Array.isArray(data.relations) ? data.relations : [])
    } catch {
      setAnalyzeError("解析中にエラーが発生しました")
    } finally {
      setAnalyzing(false)
    }
  }

  // クラス候補承認: クラス作成 + インスタンス登録を一括
  const approveClassCandidate = async (cand: ClassCandidate) => {
    if (!currentProject || !cand.proposedClassName.trim()) return
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
      await fetch("/api/instances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: currentProject.id, name: cand.instanceName, classId: newClass.id }),
      })
      updateClassCand(cand.id, { status: "新規追加", saving: false })
    } catch {
      updateClassCand(cand.id, { saving: false })
    }
  }

  const approveAsMerge = (id: string) => updateInst(id, { status: "統合済み" })

  const approveAsNew = async (cand: InstanceCandidate) => {
    if (!currentProject || !cand.classId) return
    updateInst(cand.id, { saving: true })
    try {
      await fetch("/api/instances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: currentProject.id, name: cand.name, classId: cand.classId }),
      })
      updateInst(cand.id, { status: "新規追加", saving: false })
    } catch {
      updateInst(cand.id, { saving: false })
    }
  }

  const approveRelation = async (cand: RelationCandidate) => {
    if (!currentProject || !cand.sourceClassId || !cand.targetClassId || !cand.relationName.trim()) return
    updateRel(cand.id, { saving: true })
    try {
      const newPair = { sourceClassId: cand.sourceClassId, targetClassId: cand.targetClassId }
      const existing = existingRelations.find((r) => r.name === cand.relationName.trim())
      if (existing) {
        const pairs = [...(existing.classPairs ?? []), newPair]
        await fetch(`/api/relations/${existing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ classPairs: pairs }),
        })
        setExistingRelations((p) => p.map((r) => (r.id === existing.id ? { ...r, classPairs: pairs } : r)))
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
        setExistingRelations((p) => [...p, newRel])
      }
      updateRel(cand.id, { status: "承認済み", saving: false })
    } catch {
      updateRel(cand.id, { saving: false })
    }
  }

  const hasCandidates = classCands.length > 0 || instCands.length > 0 || relCands.length > 0

  return (
    <div className="flex h-full flex-col">
      <TopBar title="文書取込み" />
      <div className="flex-1 overflow-auto p-6">

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
              <CardTitle className="text-base">抽出候補</CardTitle>
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
                      <div className="rounded-lg border border-border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-44">提案クラス名</TableHead>
                              <TableHead>説明</TableHead>
                              <TableHead className="w-44">インスタンス名</TableHead>
                              <TableHead className="w-24">ステータス</TableHead>
                              <TableHead className="w-28 text-right">操作</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {classCands.map((c) => (
                              <TableRow key={c.id}>
                                <TableCell className="align-top">
                                  <Input className="h-8" value={c.proposedClassName}
                                    disabled={c.status !== "確認中"}
                                    onChange={(e) => updateClassCand(c.id, { proposedClassName: e.target.value })} />
                                </TableCell>
                                <TableCell className="align-top">
                                  <Input className="h-8 text-sm" value={c.proposedClassDescription}
                                    disabled={c.status !== "確認中"}
                                    onChange={(e) => updateClassCand(c.id, { proposedClassDescription: e.target.value })} />
                                </TableCell>
                                <TableCell className="align-top">
                                  <Input className="h-8" value={c.instanceName}
                                    disabled={c.status !== "確認中"}
                                    onChange={(e) => updateClassCand(c.id, { instanceName: e.target.value })} />
                                </TableCell>
                                <TableCell className="align-top pt-2">
                                  <StatusBadge status={c.status} />
                                </TableCell>
                                <TableCell className="align-top pt-2">
                                  <div className="flex justify-end gap-1.5">
                                    <Button size="sm" variant="outline" className="h-7 gap-1 bg-transparent"
                                      disabled={c.status !== "確認中" || c.saving || !c.proposedClassName.trim()}
                                      onClick={() => approveClassCandidate(c)}>
                                      {c.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                      承認
                                    </Button>
                                    <Button size="sm" variant="outline" className="h-7 gap-1 bg-transparent text-destructive"
                                      disabled={c.status !== "確認中" || c.saving}
                                      onClick={() => updateClassCand(c.id, { status: "却下" })}>
                                      <X className="h-3.5 w-3.5" />却下
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                </TabsContent>

                {/* リレーション候補 */}
                <TabsContent value="relations" className="mt-4">
                  {relCands.length === 0
                    ? <p className="py-4 text-center text-sm text-muted-foreground">リレーション候補がありません</p>
                    : (
                      <div className="rounded-lg border border-border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-40">始点クラス</TableHead>
                              <TableHead>リレーション名 / 説明</TableHead>
                              <TableHead className="w-40">終点クラス</TableHead>
                              <TableHead className="w-24">ステータス</TableHead>
                              <TableHead className="w-28 text-right">操作</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {relCands.map((c) => (
                              <TableRow key={c.id}>
                                <TableCell className="align-top">
                                  <Select value={c.sourceClassId ?? "__none__"} disabled={c.status !== "確認中"}
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
                                </TableCell>
                                <TableCell className="align-top">
                                  <Input className="h-8" value={c.relationName} disabled={c.status !== "確認中"}
                                    onChange={(e) => updateRel(c.id, { relationName: e.target.value })} />
                                  {c.description && (
                                    <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{c.description}</p>
                                  )}
                                </TableCell>
                                <TableCell className="align-top">
                                  <Select value={c.targetClassId ?? "__none__"} disabled={c.status !== "確認中"}
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
                                </TableCell>
                                <TableCell className="align-top pt-2">
                                  <StatusBadge status={c.status} />
                                </TableCell>
                                <TableCell className="align-top pt-2">
                                  <div className="flex justify-end gap-1.5">
                                    <Button size="sm" variant="outline" className="h-7 gap-1 bg-transparent"
                                      disabled={c.status !== "確認中" || c.saving || !c.sourceClassId || !c.targetClassId || !c.relationName.trim()}
                                      onClick={() => approveRelation(c)}>
                                      {c.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                      承認
                                    </Button>
                                    <Button size="sm" variant="outline" className="h-7 gap-1 bg-transparent text-destructive"
                                      disabled={c.status !== "確認中" || c.saving}
                                      onClick={() => updateRel(c.id, { status: "却下" })}>
                                      <X className="h-3.5 w-3.5" />却下
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                </TabsContent>

                {/* インスタンス候補 */}
                <TabsContent value="instances" className="mt-4">
                  {instCands.length === 0
                    ? <p className="py-4 text-center text-sm text-muted-foreground">インスタンス候補がありません</p>
                    : (
                      <div className="rounded-lg border border-border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-44">候補名</TableHead>
                              <TableHead>割当先クラス</TableHead>
                              <TableHead className="w-24">ステータス</TableHead>
                              <TableHead className="w-44 text-right">操作</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {instCands.map((c) => (
                              <TableRow key={c.id}>
                                <TableCell className="align-top">
                                  <Input className="h-8" value={c.name} disabled={c.status !== "確認中"}
                                    onChange={(e) => updateInst(c.id, { name: e.target.value })} />
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
                                    <Select value={c.classId ?? "__none__"} disabled={c.status !== "確認中"}
                                      onValueChange={(v) => {
                                        if (v === "__none__") { updateInst(c.id, { classId: null, className: "" }) }
                                        else {
                                          const cls = classes.find((x) => x.id === v)
                                          updateInst(c.id, { classId: v, className: cls?.name ?? "" })
                                        }
                                      }}>
                                      <SelectTrigger className="h-8 w-56">
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
                                  <StatusBadge status={c.status} />
                                </TableCell>
                                <TableCell className="align-top pt-2">
                                  <div className="flex justify-end gap-1.5 flex-wrap">
                                    {c.candidateType === "merge" && (
                                      <Button size="sm" variant="outline"
                                        className="h-7 gap-1 bg-transparent text-blue-600 border-blue-200 hover:bg-blue-50"
                                        disabled={c.status !== "確認中" || c.saving}
                                        onClick={() => approveAsMerge(c.id)}>
                                        <Check className="h-3.5 w-3.5" />統合
                                      </Button>
                                    )}
                                    <Button size="sm" variant="outline" className="h-7 gap-1 bg-transparent"
                                      disabled={c.status !== "確認中" || c.saving || !c.classId}
                                      onClick={() => approveAsNew(c)}>
                                      {c.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                      新規追加
                                    </Button>
                                    <Button size="sm" variant="outline" className="h-7 gap-1 bg-transparent text-destructive"
                                      disabled={c.status !== "確認中" || c.saving}
                                      onClick={() => updateInst(c.id, { status: "却下" })}>
                                      <X className="h-3.5 w-3.5" />却下
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
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
