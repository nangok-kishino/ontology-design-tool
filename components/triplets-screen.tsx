"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { SectionHeader } from "@/components/section-header"
import { cn } from "@/lib/utils"
import { useProject } from "@/app/project-context"
import { isConfirmed } from "@/lib/instance-status"
import { buildCypher } from "@/lib/graph-export"
import type { Triplet, OntologyInstance, OntologyRelation, OntologyClass } from "@/lib/types"
import { ArrowRight, Plus, Trash2, Loader2, Download, FileText } from "lucide-react"

function formatDateTime(iso: string | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
}

type Draft = { subjectInstanceId: string; predicateRelationId: string; objectInstanceId: string }
const EMPTY_DRAFT: Draft = { subjectInstanceId: "", predicateRelationId: "", objectInstanceId: "" }

export function TripletsScreen({ active }: { active?: boolean }) {
  const { currentProject, loading: projectLoading } = useProject()
  const [triplets, setTriplets] = useState<Triplet[]>([])
  const [instances, setInstances] = useState<OntologyInstance[]>([])
  const [relations, setRelations] = useState<OntologyRelation[]>([])
  const [classes, setClasses] = useState<OntologyClass[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // 追加ダイアログ
  const [showAdd, setShowAdd] = useState(false)
  const [addDraft, setAddDraft] = useState<Draft>(EMPTY_DRAFT)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  // 右ペイン編集
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // 削除
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Neo4jエクスポート
  const [showExport, setShowExport] = useState(false)

  const confirmedInstances = useMemo(
    () => instances.filter((i) => isConfirmed(i)).sort((a, b) => a.name.localeCompare(b.name, "ja")),
    [instances],
  )
  const classNameById = useMemo(() => new Map(classes.map((c) => [c.id, c.name])), [classes])
  const instById = useMemo(() => new Map(instances.map((i) => [i.id, i])), [instances])
  const relById = useMemo(() => new Map(relations.map((r) => [r.id, r])), [relations])
  const className = (id: string | null) => (id ? (classNameById.get(id) ?? "不明") : "未分類")

  const fetchAll = useCallback(async () => {
    if (!currentProject) return
    setLoading(true)
    try {
      const [t, i, r, c] = await Promise.all([
        fetch(`/api/triplets?projectId=${currentProject.id}`).then((res) => res.json()),
        fetch(`/api/instances?projectId=${currentProject.id}`).then((res) => res.json()),
        fetch(`/api/relations?projectId=${currentProject.id}`).then((res) => res.json()),
        fetch(`/api/classes?projectId=${currentProject.id}`).then((res) => res.json()),
      ])
      setTriplets(Array.isArray(t) ? t : [])
      setInstances(Array.isArray(i) ? i : [])
      setRelations(Array.isArray(r) ? r : [])
      setClasses(Array.isArray(c) ? c : [])
    } finally {
      setLoading(false)
    }
  }, [currentProject?.id])

  useEffect(() => {
    if (projectLoading) return
    if (!currentProject) {
      setTriplets([]); setInstances([]); setRelations([]); setClasses([]); setSelectedId(null); setLoading(false)
      return
    }
    setSelectedId(null)
    fetchAll()
  }, [currentProject?.id, projectLoading])

  useEffect(() => {
    if (active && currentProject) fetchAll()
  }, [active, currentProject?.id, fetchAll])

  const selected = triplets.find((t) => t.id === selectedId) ?? null

  // 選択が変わったら編集フィールドを対象トリプレットで初期化
  useEffect(() => {
    if (selected) {
      setEditDraft({
        subjectInstanceId: selected.subjectInstanceId,
        predicateRelationId: selected.predicateRelationId,
        objectInstanceId: selected.objectInstanceId,
      })
      setSaveError(null)
    }
  }, [selectedId])

  // 未選択時は先頭を自動選択
  useEffect(() => {
    if (loading || selectedId || triplets.length === 0) return
    setSelectedId(triplets[0].id)
  }, [loading, selectedId, triplets.length])

  // 3要素すべて選択済みか（保存/追加の活性判定）。クラスペアの整合はサーバが検証し、
  // 不整合ならエラーを返す（前設計の整合表示は廃止）。
  const isComplete = (d: Draft) => !!(d.subjectInstanceId && d.predicateRelationId && d.objectInstanceId)

  const noPrereq = confirmedInstances.length < 2 || relations.length === 0

  const openAdd = () => { setAddDraft(EMPTY_DRAFT); setAddError(null); setShowAdd(true) }

  const handleAdd = async () => {
    if (!currentProject || !isComplete(addDraft)) return
    setAdding(true); setAddError(null)
    try {
      const res = await fetch("/api/triplets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: currentProject.id, ...addDraft }),
      })
      const created = await res.json()
      if (!res.ok) { setAddError(created.error ?? "追加に失敗しました"); return }
      await fetchAll()
      setSelectedId(created.id)
      setShowAdd(false)
    } finally {
      setAdding(false)
    }
  }

  const editDirty = !!selected && (
    editDraft.subjectInstanceId !== selected.subjectInstanceId ||
    editDraft.predicateRelationId !== selected.predicateRelationId ||
    editDraft.objectInstanceId !== selected.objectInstanceId
  )

  const handleSave = async () => {
    if (!selected || !isComplete(editDraft)) return
    setSaving(true); setSaveError(null)
    try {
      const res = await fetch(`/api/triplets/${selected.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editDraft),
      })
      const updated = await res.json()
      if (!res.ok) { setSaveError(updated.error ?? "保存に失敗しました"); return }
      await fetchAll()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selected) return
    setDeleting(true)
    try {
      await fetch(`/api/triplets/${selected.id}`, { method: "DELETE" })
      await fetchAll()
      setSelectedId(null)
      setShowDelete(false)
    } finally {
      setDeleting(false)
    }
  }

  const cypher = useMemo(() => (triplets.length > 0 ? buildCypher(triplets, classNameById, instById) : ""), [triplets, classNameById, instById])
  const nodeCount = useMemo(() => {
    const ids = new Set<string>()
    triplets.forEach((t) => { ids.add(t.subjectInstanceId); ids.add(t.objectInstanceId) })
    return ids.size
  }, [triplets])

  const handleDownloadCypher = () => {
    if (!cypher) return
    const blob = new Blob([cypher], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `triplets_${currentProject?.name ?? "graph"}.cypher`
    a.click()
    URL.revokeObjectURL(url)
  }

  const instLabel = (id: string) => {
    const inst = instById.get(id)
    if (!inst) return "（不明）"
    const cls = inst.classId ? classNameById.get(inst.classId) : undefined
    return cls ? `${inst.name}　〈${cls}〉` : inst.name
  }

  // S → P → O をノード/エッジのBadgeで表示（クラス名はマウスオーバー）
  const TripleView = ({ t, size = "sm" }: { t: Triplet; size?: "sm" | "base" }) => {
    const cls = size === "base" ? "h-auto px-2.5 py-1 text-sm font-normal" : "h-auto px-2 py-0.5 text-xs font-normal"
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary" title={`クラス：${className(t.subjectClassId)}`} className={cls}>{t.subjectName}</Badge>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <Badge variant="secondary" title="リレーション（エッジ）" className={cls}>{t.predicateName}</Badge>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <Badge variant="secondary" title={`クラス：${className(t.objectClassId)}`} className={cls}>{t.objectName}</Badge>
      </div>
    )
  }

  // クラスペア整合に基づく絞り込み（主語クラス → 選べる述語 → 選べる目的語クラス）。
  // 判定は lib/triplet-resolve.ts の relationAllowsPair と同じ完全一致（子クラスは
  // リレーション側でペア展開済みという前提）。
  const subjClassOf = (id: string) => instById.get(id)?.classId ?? null
  const relationsForSubject = (subjectId: string) => {
    const scid = subjectId ? subjClassOf(subjectId) : null
    if (!scid) return relations
    return relations.filter((r) => (r.classPairs ?? []).some((p) => p.sourceClassId === scid))
  }
  const objectsForSubjectRel = (subjectId: string, relId: string) => {
    const scid = subjectId ? subjClassOf(subjectId) : null
    const rel = relId ? relById.get(relId) : null
    if (!scid || !rel) return confirmedInstances
    const targets = new Set(
      (rel.classPairs ?? []).filter((p) => p.sourceClassId === scid).map((p) => p.targetClassId),
    )
    return confirmedInstances.filter((i) => i.classId && targets.has(i.classId))
  }

  const TripleSelects = ({ draft, onChange }: { draft: Draft; onChange: (d: Draft) => void }) => {
    const relOptions = relationsForSubject(draft.subjectInstanceId)
    const objOptions = objectsForSubjectRel(draft.subjectInstanceId, draft.predicateRelationId)

    // 上流が変わったら、不整合になった下流の選択を自動クリア
    const changeSubject = (v: string | null) => {
      const sid = v && v !== "__none__" ? v : ""
      const next: Draft = { ...draft, subjectInstanceId: sid }
      if (next.predicateRelationId && !relationsForSubject(sid).some((r) => r.id === next.predicateRelationId)) next.predicateRelationId = ""
      if (next.objectInstanceId && !objectsForSubjectRel(sid, next.predicateRelationId).some((o) => o.id === next.objectInstanceId)) next.objectInstanceId = ""
      onChange(next)
    }
    const changePredicate = (v: string | null) => {
      const rid = v && v !== "__none__" ? v : ""
      const next: Draft = { ...draft, predicateRelationId: rid }
      if (next.objectInstanceId && !objectsForSubjectRel(next.subjectInstanceId, rid).some((o) => o.id === next.objectInstanceId)) next.objectInstanceId = ""
      onChange(next)
    }
    const changeObject = (v: string | null) => onChange({ ...draft, objectInstanceId: v && v !== "__none__" ? v : "" })

    return (
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">ノード（主語） <span className="text-destructive">*</span></Label>
          <Select value={draft.subjectInstanceId || "__none__"} onValueChange={changeSubject}>
            <SelectTrigger className="h-8 w-full min-w-0"><SelectValue>{draft.subjectInstanceId ? instLabel(draft.subjectInstanceId) : "選択"}</SelectValue></SelectTrigger>
            <SelectContent className="max-h-72">
              {confirmedInstances.map((i) => <SelectItem key={i.id} value={i.id}>{instLabel(i.id)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">エッジ（述語） <span className="text-destructive">*</span></Label>
          <Select value={draft.predicateRelationId || "__none__"} onValueChange={changePredicate} disabled={relOptions.length === 0}>
            <SelectTrigger className="h-8 w-full min-w-0"><SelectValue>{draft.predicateRelationId ? (relById.get(draft.predicateRelationId)?.name ?? "選択") : "選択"}</SelectValue></SelectTrigger>
            <SelectContent className="max-h-72">
              {relOptions.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {draft.subjectInstanceId && relOptions.length === 0 && (
            <p className="text-xs text-muted-foreground">この主語のクラスを始点に持つリレーションが定義されていません。</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">ノード（目的語） <span className="text-destructive">*</span></Label>
          <Select value={draft.objectInstanceId || "__none__"} onValueChange={changeObject}>
            <SelectTrigger className="h-8 w-full min-w-0"><SelectValue>{draft.objectInstanceId ? instLabel(draft.objectInstanceId) : "選択"}</SelectValue></SelectTrigger>
            <SelectContent className="max-h-72">
              {objOptions.map((i) => <SelectItem key={i.id} value={i.id}>{instLabel(i.id)}</SelectItem>)}
            </SelectContent>
          </Select>
          {draft.subjectInstanceId && draft.predicateRelationId && objOptions.length === 0 && (
            <p className="text-xs text-muted-foreground">この組み合わせに一致する目的語（本登録インスタンス）がありません。</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar title="トリプレット管理">
        <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-transparent"
          onClick={() => setShowExport(true)} disabled={!currentProject || triplets.length === 0}>
          <Download className="h-3.5 w-3.5" />Neo4jエクスポート
        </Button>
      </TopBar>

      <div className="flex flex-1 overflow-hidden">
        {/* 一覧 */}
        <div className="flex flex-1 flex-col overflow-hidden border-r border-border">
          <div className="flex items-center justify-between px-6 py-3">
            <h2 className="text-base font-semibold text-foreground">トリプレット管理</h2>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-transparent" onClick={openAdd} disabled={!currentProject}>
              <Plus className="h-3.5 w-3.5" />トリプレットを追加
            </Button>
          </div>
          <div className="flex-1 overflow-auto px-6 pb-6">
            {loading ? (
              <div className="flex h-32 items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : !currentProject ? (
              <p className="p-4 text-center text-sm text-muted-foreground">プロジェクトを選択してください</p>
            ) : triplets.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">トリプレットが登録されていません</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="font-semibold text-foreground">トリプレット</TableHead>
                      <TableHead className="w-36 font-semibold text-foreground">出典</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {triplets.map((t) => (
                      <TableRow key={t.id}
                        className={cn(
                          "cursor-pointer transition-colors",
                          selectedId === t.id
                            ? "bg-indigo-100 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-950/50"
                            : "hover:bg-muted/50",
                        )}
                        onClick={() => setSelectedId(t.id)}>
                        <TableCell className="align-middle"><TripleView t={t} /></TableCell>
                        <TableCell className="align-middle text-sm text-muted-foreground">{t.sourceDocName || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>

        {/* 詳細（右ペイン・常時表示） */}
        <div className="flex w-[30rem] shrink-0 flex-col overflow-hidden bg-card">
          {selected ? (
            <>
              <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
                <section className="space-y-3">
                  <SectionHeader icon={FileText} title="基本情報" />
                  <div className="space-y-3">
                    <div className="space-y-0.5 text-xs text-muted-foreground">
                      <p>登録日 {formatDateTime(selected.createdAt)}{selected.createdBy ? `（${selected.createdBy}）` : ""}</p>
                      <p>更新日 {formatDateTime(selected.updatedAt)}{selected.updatedBy ? `（${selected.updatedBy}）` : ""}</p>
                    </div>
                    <TripleSelects draft={editDraft} onChange={setEditDraft} />
                    {selected.sourceDocName && (
                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium">出典</Label>
                        <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">{selected.sourceDocName}</p>
                      </div>
                    )}
                    {selected.evidence && (
                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium">抽出元文章</Label>
                        <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">{selected.evidence}</p>
                      </div>
                    )}
                    {saveError && <p className="text-sm text-destructive">{saveError}</p>}
                  </div>
                </section>
              </div>

              <div className="flex items-center justify-between border-t border-border px-4 py-3">
                <Button variant="ghost" size="sm"
                  className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setShowDelete(true)}>
                  <Trash2 className="h-3.5 w-3.5" />削除
                </Button>
                <Button size="sm" variant="success" onClick={handleSave} disabled={!isComplete(editDraft) || saving || !editDirty}>
                  {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}保存
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
              トリプレットを選択してください
            </div>
          )}
        </div>
      </div>

      {/* 追加ダイアログ */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>トリプレットを追加</DialogTitle></DialogHeader>
          {noPrereq ? (
            <p className="py-4 text-sm text-muted-foreground">
              トリプレットの作成には、本登録インスタンスが2つ以上と、定義済みリレーションが必要です。先にオントロジー設計（インスタンス・リレーションの本登録）を進めてください。
            </p>
          ) : (
            <div className="min-w-0 space-y-4 py-2">
              <TripleSelects draft={addDraft} onChange={setAddDraft} />
              {addError && <p className="text-sm text-destructive">{addError}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>キャンセル</Button>
            <Button onClick={handleAdd} disabled={noPrereq || !isComplete(addDraft) || adding}>
              {adding ? "登録中..." : "登録"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 削除確認 */}
      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent>
          <DialogHeader><DialogTitle>トリプレットを削除</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">このトリプレットを削除します。この操作は取り消せません。</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)} disabled={deleting}>キャンセル</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>{deleting ? "削除中..." : "削除する"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Neo4jエクスポート */}
      <Dialog open={showExport} onOpenChange={setShowExport}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>Neo4j へエクスポート</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              本登録トリプレット {triplets.length} 件 ／ ノード {nodeCount}・エッジ {triplets.length}。冪等な Cypher（MERGE）です。Neo4j Aura の Browser / cypher-shell に貼るか、ダウンロードして実行してください。
            </p>
            <pre className="max-h-80 overflow-auto rounded-lg bg-zinc-950 p-4 text-xs leading-relaxed text-zinc-100">{cypher}</pre>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExport(false)}>閉じる</Button>
            <Button className="gap-1.5" onClick={handleDownloadCypher} disabled={!cypher}>
              <Download className="h-4 w-4" />.cypher をダウンロード
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
