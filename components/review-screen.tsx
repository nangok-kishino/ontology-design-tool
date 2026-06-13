"use client"

import { useState } from "react"
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
import {
  classCandidates as initialClassCandidates,
  relationCandidates as initialRelationCandidates,
  parentClassOptions,
  type CandidateStatus,
} from "@/lib/ontology-data"
import { UploadCloud, FileText, Check, X, ArrowRight, Sparkles } from "lucide-react"

function StatusBadge({ status }: { status: CandidateStatus }) {
  const map: Record<CandidateStatus, string> = {
    確認中: "bg-muted text-muted-foreground",
    承認済み: "bg-emerald-100 text-emerald-700",
    却下: "bg-red-100 text-red-700",
  }
  return <Badge className={`font-normal ${map[status]}`}>{status}</Badge>
}

export function ReviewScreen() {
  const [fileName, setFileName] = useState<string | null>(null)
  const [classCands, setClassCands] = useState(initialClassCandidates)
  const [relCands, setRelCands] = useState(initialRelationCandidates)

  const [approveTarget, setApproveTarget] = useState<string | null>(null)
  const [placement, setPlacement] = useState("top")
  const [parentClass, setParentClass] = useState(parentClassOptions[0])

  const updateClassStatus = (id: string, status: CandidateStatus) =>
    setClassCands((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)))
  const updateRelStatus = (id: string, status: CandidateStatus) =>
    setRelCands((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)))

  const confirmApprove = () => {
    if (approveTarget) updateClassStatus(approveTarget, "承認済み")
    setApproveTarget(null)
    setPlacement("top")
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar title="文書取込み" />
      <div className="flex-1 overflow-auto p-6">
        {/* セクション1：ドキュメント取込 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ドキュメント取込</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/40 px-6 py-10 text-center">
              <UploadCloud className="h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm text-foreground">
                {fileName ? (
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    <FileText className="h-4 w-4" />
                    {fileName}
                  </span>
                ) : (
                  "ここにファイルをドラッグ＆ドロップ"
                )}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">対応形式：PDF, DOCX, TXT</p>
              <Button
                size="sm"
                variant="outline"
                className="mt-4 bg-transparent"
                onClick={() => setFileName("製造不具合報告書_2024Q2.pdf")}
              >
                ファイルを選択
              </Button>
            </div>
            <div className="mt-4 flex justify-end">
              <Button size="sm" disabled={!fileName} className="gap-2">
                <Sparkles className="h-4 w-4" />
                LLMで解析する
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* セクション2：抽出候補 */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">抽出候補</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="classes">
              <TabsList>
                <TabsTrigger value="classes">クラス候補</TabsTrigger>
                <TabsTrigger value="relations">リレーション候補</TabsTrigger>
              </TabsList>

              <TabsContent value="classes" className="mt-4">
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
              </TabsContent>

              <TabsContent value="relations" className="mt-4">
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
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
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
                <Select value={parentClass} onValueChange={setParentClass}>
                  <SelectTrigger id="parent-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {parentClassOptions.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
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
            <Button onClick={confirmApprove}>確定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
