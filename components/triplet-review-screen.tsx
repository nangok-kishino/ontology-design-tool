"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { TopBar } from "@/components/top-bar"
import { cn } from "@/lib/utils"
import { useProject } from "@/app/project-context"
import type { OntologyClass } from "@/lib/types"
import type { ResolvedTripletCandidate } from "@/lib/triplet-resolve"
import { UploadCloud, FileText, Sparkles, Loader2, Check, ArrowRight, RotateCw } from "lucide-react"

const MODEL_OPTIONS = [
  { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
  { id: "claude-opus-5", label: "Claude Opus 5" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
]

// クラス抽出（文書取込み）と同じステータス体系：確認中 → 採用候補 → 本登録済み
type CandStatus = "確認中" | "採用候補" | "本登録済み"
type Row = ResolvedTripletCandidate & { uiStatus: CandStatus; saving: boolean }

// 残り候補数などを示す小さなカウントバッジ（オントロジー抽出画面と同じ見た目）
function CountPill({ n }: { n: number }) {
  return (
    <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
      {n}
    </span>
  )
}

function StatusBadge({ status }: { status: CandStatus }) {
  const map: Record<CandStatus, string> = {
    確認中: "border-border bg-muted text-muted-foreground",
    採用候補: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
    本登録済み: "border-green-300 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300",
  }
  return <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${map[status]}`}>{status}</span>
}

export function TripletReviewScreen({ active, ingestVersion, onIngested }: { active?: boolean; ingestVersion?: number; onIngested?: () => void }) {
  const { currentProject } = useProject()
  const fileInputRef = useRef<HTMLInputElement>(null)
  // 直近に解析したファイル（解析後は file を null にするため、再実行用に保持する）
  const lastFileRef = useRef<File | null>(null)

  const [selectedModel, setSelectedModel] = useState(MODEL_OPTIONS[0].id)
  const [file, setFile] = useState<File | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [analyzedInfo, setAnalyzedInfo] = useState<{ doc: string; model: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [rows, setRows] = useState<Row[]>([])
  const [classes, setClasses] = useState<OntologyClass[]>([])
  const [loading, setLoading] = useState(true)
  const [registering, setRegistering] = useState(false)

  const classNameById = useMemo(() => new Map(classes.map((c) => [c.id, c.name])), [classes])
  const className = (id: string | null) => (id ? (classNameById.get(id) ?? "不明") : "未分類")

  const fetchCandidates = useCallback(async () => {
    if (!currentProject) return
    setLoading(true)
    try {
      const [cands, cls] = await Promise.all([
        fetch(`/api/triplet-candidates?projectId=${currentProject.id}`).then((r) => r.json()),
        fetch(`/api/classes?projectId=${currentProject.id}`).then((r) => r.json()),
      ])
      const list: ResolvedTripletCandidate[] = Array.isArray(cands) ? cands : []
      setRows(list.map((c) => ({ ...c, uiStatus: "確認中" as CandStatus, saving: false })))
      setClasses(Array.isArray(cls) ? cls : [])
    } finally {
      setLoading(false)
    }
  }, [currentProject?.id])

  useEffect(() => {
    if (!currentProject) { setRows([]); setClasses([]); setLoading(false); return }
    fetchCandidates()
  }, [currentProject?.id])

  useEffect(() => {
    if (active && currentProject) fetchCandidates()
  }, [active, currentProject?.id, fetchCandidates])

  // オントロジー抽出画面で取込みが実行されたら（ingestVersion 変化）、この画面が非アクティブの間に
  // トリプレット候補を再取得する（1回の取込みを両画面で共有する合意仕様）。
  const ingestVersionRef = useRef(ingestVersion)
  useEffect(() => {
    if (ingestVersionRef.current === ingestVersion) return
    ingestVersionRef.current = ingestVersion
    if (!active && currentProject) fetchCandidates()
  }, [ingestVersion, active, currentProject?.id, fetchCandidates])

  const handleFileChange = (f: File | null) => { if (!f) return; setFile(f); setAnalyzeError(null) }

  const handleAnalyze = async (f?: File) => {
    const target = f ?? file
    if (!target || !currentProject) return
    setAnalyzing(true)
    setAnalyzeError(null)
    // 解析開始時に前回の結果をクリアし、解析中はローディングを表示する（成功時に新結果へ差し替え）
    setRows([])
    setNotice(null)
    try {
      const fd = new FormData()
      fd.append("file", target)
      fd.append("projectId", currentProject.id)
      fd.append("model", selectedModel)
      const res = await fetch("/api/ingest", { method: "POST", body: fd })
      const data = await res.json()
      if (!res.ok) { setAnalyzeError(data.error ?? "抽出に失敗しました"); return }
      setAnalyzedInfo({ doc: data.sourceDocName, model: MODEL_OPTIONS.find((m) => m.id === selectedModel)?.label ?? selectedModel })
      setNotice(data.tripletNote ?? null)
      await fetchCandidates()
      lastFileRef.current = target
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ""
      // 同一取込みでオントロジー候補も保存済み。オントロジー抽出画面へ共有（再反映）を通知する。
      onIngested?.()
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : String(e))
    } finally {
      setAnalyzing(false)
    }
  }

  const resolvable = (r: Row) => !!(r.subjectInstanceId && r.predicateRelationId && r.objectInstanceId)

  // 確認中 ⇔ 採用候補（本登録済みは触らない）
  const toggleSelect = (id: string) => {
    setRows((prev) => prev.map((r) => {
      if (r.id !== id || r.uiStatus === "本登録済み" || !resolvable(r)) return r
      return { ...r, uiStatus: r.uiStatus === "採用候補" ? "確認中" : "採用候補" }
    }))
  }

  const selectedCount = rows.filter((r) => r.uiStatus === "採用候補").length
  // 見出しに出す「残り候補数」。本登録済みは候補から外れるので数えない。
  const remainingCount = rows.filter((r) => r.uiStatus !== "本登録済み").length

  // 全選択/全選択解除（解決可能かつ本登録済みでない行が対象）
  const selectableRows = rows.filter((r) => resolvable(r) && r.uiStatus !== "本登録済み")
  const allSelected = selectableRows.length > 0 && selectableRows.every((r) => r.uiStatus === "採用候補")
  const toggleAll = () =>
    setRows((prev) => {
      const sel = prev.filter((r) => resolvable(r) && r.uiStatus !== "本登録済み")
      const allSel = sel.length > 0 && sel.every((r) => r.uiStatus === "採用候補")
      return prev.map((r) =>
        resolvable(r) && r.uiStatus !== "本登録済み" ? { ...r, uiStatus: allSel ? "確認中" : "採用候補" } : r,
      )
    })

  const registerSelected = async () => {
    if (!currentProject) return
    const targets = rows.filter((r) => r.uiStatus === "採用候補" && resolvable(r))
    if (targets.length === 0) return
    setRegistering(true)
    try {
      for (const r of targets) {
        setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, saving: true } : x)))
        try {
          const res = await fetch("/api/triplets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: currentProject.id,
              subjectInstanceId: r.subjectInstanceId,
              predicateRelationId: r.predicateRelationId,
              objectInstanceId: r.objectInstanceId,
              sourceDocName: r.sourceDocName,
              evidence: r.evidence,
              sourceCandidateId: r.id,
            }),
          })
          if (res.ok) {
            await fetch(`/api/triplet-candidates/${r.id}`, { method: "DELETE" })
            setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, uiStatus: "本登録済み", saving: false } : x)))
          } else {
            setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, saving: false } : x)))
          }
        } catch {
          setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, saving: false } : x)))
        }
      }
    } finally {
      setRegistering(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar title="トリプレット抽出" />
      <div className="flex-1 overflow-auto p-6">

        <div className="mb-6 flex items-start justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            定義済みのクラス・リレーションと登録済みインスタンスに基づいて、既存文書からトリプレット（主語 → 述語 → 目的語）を抽出します。
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <span className="whitespace-nowrap text-sm font-medium text-foreground">解析AIモデル（LLM）選択</span>
            <Select value={selectedModel} onValueChange={(v) => { if (v) setSelectedModel(v) }} disabled={analyzing}>
              <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MODEL_OPTIONS.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-sm">ファイル指定</CardTitle></CardHeader>
          <CardContent>
            <input ref={fileInputRef} type="file" accept=".txt,.pdf" className="hidden"
              onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)} />
            <div className="flex items-stretch gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex h-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/40 px-6 py-6 text-center"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); handleFileChange(e.dataTransfer.files?.[0] ?? null) }}>
                  <UploadCloud className="h-7 w-7 text-muted-foreground" />
                  <p className="mt-2 text-sm text-foreground">
                    {file
                      ? <span className="inline-flex items-center gap-1.5 font-medium"><FileText className="h-4 w-4" />{file.name}</span>
                      : "ここにファイルをドラッグ＆ドロップ"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">対応形式：PDF, TXT</p>
                  <Button size="sm" variant="outline" className="mt-3 bg-transparent" onClick={() => fileInputRef.current?.click()}>
                    ファイルを選択
                  </Button>
                </div>
              </div>
              <Button disabled={!file || analyzing || !currentProject}
                className="h-auto w-48 shrink-0 gap-2 self-stretch whitespace-nowrap border-0 text-base font-semibold text-white shadow-lg transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #be185d 0%, #7e22ce 50%, #4c1d95 100%)" }}
                onClick={() => handleAnalyze()}>
                {analyzing ? <><Loader2 className="h-5 w-5 animate-spin" />解析中...</> : <><Sparkles className="h-5 w-5" />LLMで解析する</>}
              </Button>
            </div>
            {analyzeError && <p className="mt-3 text-sm text-destructive">{analyzeError}</p>}
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base flex flex-wrap items-center gap-2">
                抽出トリプレット
                {!analyzing && <CountPill n={remainingCount} />}
                {!analyzing && analyzedInfo && (
                  <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
                    <FileText className="h-3.5 w-3.5" />{analyzedInfo.doc}
                  </span>
                )}
                {!analyzing && analyzedInfo && (
                  <span className="text-xs font-normal text-muted-foreground">
                    利用モデル：{analyzedInfo.model}
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
            {notice && !analyzing && (
              <div className="mb-4 rounded-md border border-border bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">{notice}</div>
            )}
            {analyzing ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  文書を解析しています。完了すると、定義済みオントロジー（登録済みインスタンス・定義済みリレーション）に基づくトリプレットが表示されます。
                </p>
              </div>
            ) : loading ? (
              <div className="flex h-24 items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : rows.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                抽出トリプレットがありません。文書を解析すると、定義済みオントロジー（登録済みインスタンス・定義済みリレーション）に基づくトリプレットが表示されます。
              </p>
            ) : (
              <>
                <div className="mb-3 flex items-center gap-3">
                  <Button variant="success" className="gap-1.5 text-sm" disabled={registering || selectedCount === 0} onClick={registerSelected}>
                    {registering && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    採用候補を本登録{selectedCount > 0 && `（${selectedCount}件）`}
                  </Button>
                  <p className="text-xs text-muted-foreground">チェックを付けて採用候補に選び、まとめて本登録できます。名前にマウスを乗せるとクラスが表示されます。</p>
                </div>
                <div className="rounded-lg border border-border">
                  <Table className="table-fixed">
                    <TableHeader>
                      <TableRow className="bg-muted/50 hover:bg-muted/50">
                        <TableHead className="w-16 text-center font-semibold text-foreground">
                          <div className="flex items-center justify-center">
                            <button
                              type="button"
                              disabled={selectableRows.length === 0}
                              aria-label="全選択 / 全選択解除"
                              title="全選択 / 全選択解除"
                              onClick={toggleAll}
                              className={cn(
                                "inline-flex h-5 w-5 items-center justify-center rounded border transition-colors",
                                selectableRows.length === 0
                                  ? "cursor-not-allowed border-input opacity-40"
                                  : allSelected
                                    ? "border-green-600 bg-green-600 text-white"
                                    : "cursor-pointer border-input hover:border-green-500",
                              )}
                            >
                              {allSelected && <Check className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        </TableHead>
                        <TableHead className="w-[46%] font-semibold text-foreground">トリプレット（ノード → エッジ → ノード）</TableHead>
                        <TableHead className="font-semibold text-foreground">抽出元文章</TableHead>
                        <TableHead className="w-24 font-semibold text-foreground">ステータス</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => {
                        const registered = r.uiStatus === "本登録済み"
                        const selected = r.uiStatus === "採用候補"
                        const canSelect = resolvable(r) && !registered
                        return (
                          <TableRow key={r.id} className={cn(registered && "opacity-50", selected && "bg-green-50/60 dark:bg-green-950/20")}>
                            <TableCell className="text-center align-middle">
                              <button type="button" disabled={!canSelect} aria-label="採用候補に選ぶ"
                                onClick={() => toggleSelect(r.id)}
                                className={cn(
                                  "inline-flex h-5 w-5 items-center justify-center rounded border transition-colors",
                                  !canSelect ? "cursor-not-allowed border-input opacity-40"
                                    : selected ? "border-green-600 bg-green-600 text-white" : "cursor-pointer border-input hover:border-green-500",
                                )}>
                                {(selected || registered) && <Check className="h-3.5 w-3.5" />}
                              </button>
                            </TableCell>
                            <TableCell className="align-middle">
                              <div className="flex flex-wrap items-center gap-2 whitespace-normal break-words">
                                <Badge variant="secondary" title={`クラス：${className(r.subjectClassId)}`} className="h-auto px-2.5 py-1 text-sm font-normal">
                                  {r.subjectName ?? r.subjectText ?? "（不明）"}
                                </Badge>
                                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                <Badge variant="secondary" title="リレーション（エッジ）" className="h-auto px-2.5 py-1 text-sm font-normal">
                                  {r.predicateName ?? r.predicateText}
                                </Badge>
                                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                <Badge variant="secondary" title={`クラス：${className(r.objectClassId)}`} className="h-auto px-2.5 py-1 text-sm font-normal">
                                  {r.objectName ?? r.objectText ?? "（不明）"}
                                </Badge>
                              </div>
                            </TableCell>
                            <TableCell className="align-middle whitespace-normal break-words text-sm text-muted-foreground">
                              {r.evidence || "—"}
                            </TableCell>
                            <TableCell className="align-middle"><StatusBadge status={r.uiStatus} /></TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
