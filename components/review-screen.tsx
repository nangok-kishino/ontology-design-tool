"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import type { ClassCandidate, RelationCandidate, CandidateStatus } from "@/lib/ontology-data"
import type { OntologyClass } from "@/lib/types"
import { UploadCloud, FileText, Check, X, ArrowRight, Sparkles, Loader2 } from "lucide-react"

function StatusBadge({ status }: { status: CandidateStatus }) {
  const map: Record<CandidateStatus, string> = {
    確認中: "bg-muted text-muted-foreground",
    承認済み: "bg-emerald-100 text-emerald-700",
    却下: "bg-red-100 text-red-700",
  }
  return <Badge className={`font-normal ${map[status]}`}>{status}</Badge>
}

export function ReviewScreen() {
  const { currentProject } = useProject()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)

  const [classCands, setClassCands] = useState<ClassCandidate[]>([])
  const [relCands, setRelCands] = useState<RelationCandidate[]>([])
  const [classes, setClasses] = useState<OntologyClass[]>([])

  const [approveTarget, setApproveTarget] = useState<string | null>(null)
  const [placement, setPlacement] = useState("top")
  const [parentClassId, setParentClassId] = useState<string>("")

  useEffect(() => {
    if (!currentProject) return
    fetch(`/api/classes?projectId=${currentProject.id}`)
      .then((r) => r.json())
      .then((data) => setClasses(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [currentProject?.id])

  const updateClassStatus = (id: string, status: CandidateStatus) =>
    setClassCands((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)))
  const updateRelStatus = (id: string, status: CandidateStatus) =>
    setRelCands((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)))

  const confirmApprove = () => {
    if (approveTarget) updateClassStatus(approveTarget, "承認済み")
    setApproveTarget(null)
    setPlacement("top")
    setParentClassId("")
  }

  const handleFileChange = (f: File | null) => {
    if (!f) return
    setFile(f)
    setAnalyzeError(null)
  }

  const handleAnalyze = async () => {
    if (!file) return
    setAnalyzing(true)
    setAnalyzeError(null)
    setClassCands([])
    setRelCands([])
    try {
      const formData = new FormData()
      formData.append("file", file)
      const res = await fetch("/api/analyze", { method: "POST", body: formData })
      const data = await res.json()
      if (!res.ok) {
        setAnalyzeError(data.error ?? "解析に失敗しました")
        return
      }
      setClassCands(Array.isArray(data.classes) ? data.classes : [])
      setRelCands(Array.isArray(data.relations) ? data.relations : [])
    } catch {
      setAnalyzeError("解析中にエラーが発生しました")
    } finally {
      setAnalyzing(false)
    }
  }

  const hasCandidates = classCands.length > 0 || relCands.length > 0

  return (
    <div className="flex h-full flex-col">
      <TopBar title="文書取込み" />
      <div className="flex-1 overflow-auto p-6">

        {/* ドキュメント取込 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ドキュメント取込</CardTitle>
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
              onDrop={(e) => {
                e.preventDefault()
                handleFileChange(e.dataTransfer.files?.[0] ?? null)
              }}
            >
              <UploadCloud className="h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm text-foreground">
                {file ? (
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    <FileText className="h-4 w-4" />
                    {file.name}
                  </span>
                ) : (
                  "ここにファイルをドラッグ＆ドロップ"
                )}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">対応形式：PDF, TXT</p>
              <Button
                size="sm"
                variant="outline"
                className="mt-4 bg-transparent"
                onClick={() => fileInputRef.current?.click()}
              >
                ファイルを選択
              </Button>
            </div>

            {analyzeError && (
              <p className="mt-3 text-sm text-destructive">{analyzeError}</p>
            )}

            <div className="mt-4 flex justify-end">
              <Button
                size="sm"
                disabled={!file || analyzing}
                className="gap-2"
                onClick={handleAnalyze}
              >
                {analyzing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    解析中...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    LLMで解析する
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* 抽出候補 */}
        {hasCandidates && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-base">抽出候補</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="classes">
                <TabsList>
                  <TabsTrigger value="classes">
                    クラス候補
                    <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
                      {classCands.length}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="relations">
                    リレーション候補
                    <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
                      {relCands.length}
                    </span>
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="classes" className="mt-4">
                  {classCands.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">クラス候補がありません</p>
                  ) : (
                    <div className="rounded-lg border border-border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-40">候補名</TableHead>
                            <TableHead>説明</TableHead>
                            <TableHead className="w-28">ステータス</TableHead>
                            <TableHead className="w-40 text-right">操作</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {classCands.map((c) => (
                            <TableRow key={c.id}>
                              <TableCell className="font-medium text-foreground">{c.name}</TableCell>
                              <TableCell className="text-muted-foreground">{c.description}</TableCell>
                              <TableCell>
                                <StatusBadge status={c.status} />
                              </TableCell>
                              <TableCell>
                                <div className="flex justify-end gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 gap-1 bg-transparent"
                                    disabled={c.status !== "確認中"}
                                    onClick={() => setApproveTarget(c.id)}
                                  >
                                    <Check className="h-3.5 w-3.5" />
                                    承認
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 gap-1 bg-transparent text-destructive"
                                    disabled={c.status !== "確認中"}
                                    onClick={() => updateClassStatus(c.id, "却下")}
                                  >
                                    <X className="h-3.5 w-3.5" />
                                    却下
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

                <TabsContent value="relations" className="mt-4">
                  {relCands.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">リレーション候補がありません</p>
                  ) : (
                    <div className="rounded-lg border border-border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>始点</TableHead>
                            <TableHead>リレーション名</TableHead>
                            <TableHead>終点</TableHead>
                            <TableHead>説明</TableHead>
                            <TableHead className="w-28">ステータス</TableHead>
                            <TableHead className="w-40 text-right">操作</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {relCands.map((c) => (
                            <TableRow key={c.id}>
                              <TableCell className="text-foreground">{c.source}</TableCell>
                              <TableCell className="font-medium text-foreground">
                                <span className="inline-flex items-center gap-1.5">
                                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                                  {c.name}
                                </span>
                              </TableCell>
                              <TableCell className="text-foreground">{c.target}</TableCell>
                              <TableCell className="text-muted-foreground">{c.description}</TableCell>
                              <TableCell>
                                <StatusBadge status={c.status} />
                              </TableCell>
                              <TableCell>
                                <div className="flex justify-end gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 gap-1 bg-transparent"
                                    disabled={c.status !== "確認中"}
                                    onClick={() => updateRelStatus(c.id, "承認済み")}
                                  >
                                    <Check className="h-3.5 w-3.5" />
                                    承認
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 gap-1 bg-transparent text-destructive"
                                    disabled={c.status !== "確認中"}
                                    onClick={() => updateRelStatus(c.id, "却下")}
                                  >
                                    <X className="h-3.5 w-3.5" />
                                    却下
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

      {/* 承認確認モーダル */}
      <Dialog open={approveTarget !== null} onOpenChange={(o) => !o && setApproveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>クラスの承認確認</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <RadioGroup value={placement} onValueChange={setPlacement}>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="top" id="top" />
                <Label htmlFor="top" className="font-normal">
                  トップレベルクラスとして追加
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="sub" id="sub" />
                <Label htmlFor="sub" className="font-normal">
                  サブクラスとして追加
                </Label>
              </div>
            </RadioGroup>

            {placement === "sub" && (
              <div className="space-y-2 pl-6">
                <Label htmlFor="parent-select">親クラスを選択</Label>
                <Select
                  value={parentClassId}
                  onValueChange={(v) => { if (v) setParentClassId(v) }}
                >
                  <SelectTrigger id="parent-select">
                    <SelectValue placeholder="親クラスを選択" />
                  </SelectTrigger>
                  <SelectContent>
                    {classes.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveTarget(null)}>
              キャンセル
            </Button>
            <Button
              onClick={confirmApprove}
              disabled={placement === "sub" && !parentClassId}
            >
              確定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
