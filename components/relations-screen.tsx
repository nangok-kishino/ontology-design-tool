"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
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
import { Tooltip } from "@/components/ui/tooltip"
import { ImportDialog } from "@/components/import-dialog"
import { SectionHeader } from "@/components/section-header"
import { cn } from "@/lib/utils"
import type { OntologyRelation, OntologyClass, OntologyAttribute, AttributeRequired, ClassPair } from "@/lib/types"
import {
  buildRelationsYaml,
  downloadYaml,
  parseRelationsYaml,
  previewRelationsImport,
  executeRelationsImport,
  type RelationExportItem,
} from "@/lib/import-export"
import { ArrowRight, Plus, Pencil, Trash2, Loader2, X, AlertTriangle, Info, Download, Upload, FileText, Tags } from "lucide-react"
import { useProject } from "@/app/project-context"

type AttrSectionKey = "project" | "own"

function formatDateTime(iso: string | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
}

export function RelationsScreen({ initialSelectedId, active }: { initialSelectedId?: string; active?: boolean }) {
  const { currentProject, loading: projectLoading } = useProject()
  const [relations, setRelations] = useState<OntologyRelation[]>([])
  const [classes, setClasses] = useState<OntologyClass[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // リレーション追加ダイアログ
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState("")
  const [newNameEn, setNewNameEn] = useState("")
  const [newDesc, setNewDesc] = useState("")
  const [newPairs, setNewPairs] = useState<ClassPair[]>([{ sourceClassId: "", targetClassId: "" }])
  const [newIncludeChildren, setNewIncludeChildren] = useState(true)
  const [editIncludeChildren, setEditIncludeChildren] = useState(true)
  const [adding, setAdding] = useState(false)

  // 編集モード
  const [editName, setEditName] = useState("")
  const [editNameEn, setEditNameEn] = useState("")
  const [editDesc, setEditDesc] = useState("")
  const [editPairs, setEditPairs] = useState<ClassPair[]>([])
  const [saving, setSaving] = useState(false)

  // 削除確認ダイアログ
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // 属性
  const [projectAttrs, setProjectAttrs] = useState<OntologyAttribute[]>([])
  const [ownAttrs, setOwnAttrs] = useState<OntologyAttribute[]>([])
  const [loadingAttrs, setLoadingAttrs] = useState(false)

  // 属性追加ダイアログ
  const [showAddAttr, setShowAddAttr] = useState(false)
  const [addAttrSection, setAddAttrSection] = useState<AttrSectionKey>("own")
  const [attrName, setAttrName] = useState("")
  const [attrDesc, setAttrDesc] = useState("")
  const [attrDataType, setAttrDataType] = useState("文字列")
  const [attrRequired, setAttrRequired] = useState<AttributeRequired>("任意")
  const [addingAttr, setAddingAttr] = useState(false)

  // 属性編集ダイアログ
  const [showEditAttr, setShowEditAttr] = useState(false)
  const [editingAttr, setEditingAttr] = useState<OntologyAttribute | null>(null)
  const [editAttrSection, setEditAttrSection] = useState<AttrSectionKey>("own")
  const [editAttrName, setEditAttrName] = useState("")
  const [editAttrDesc, setEditAttrDesc] = useState("")
  const [editAttrDataType, setEditAttrDataType] = useState("文字列")
  const [editAttrRequired, setEditAttrRequired] = useState<AttributeRequired>("任意")
  const [savingAttr, setSavingAttr] = useState(false)

  // インポート/エクスポート
  const [showImport, setShowImport] = useState(false)
  const [exporting, setExporting] = useState(false)

  // 属性削除確認
  const [showAttrAlert, setShowAttrAlert] = useState(false)
  const [attrAlertMsg, setAttrAlertMsg] = useState("")
  const [attrAlertIsWarning, setAttrAlertIsWarning] = useState(false)
  const [pendingAttrAction, setPendingAttrAction] = useState<{ fn: () => Promise<void> } | null>(null)

  const fetchRelations = useCallback(async () => {
    if (!currentProject) return
    setLoading(true)
    try {
      const data: OntologyRelation[] = await fetch(
        `/api/relations?projectId=${currentProject.id}`
      ).then((r) => r.json())
      setRelations(Array.isArray(data) ? data : [])
    } finally {
      setLoading(false)
    }
  }, [currentProject?.id])

  const fetchClasses = useCallback(async () => {
    if (!currentProject) return
    const data: OntologyClass[] = await fetch(
      `/api/classes?projectId=${currentProject.id}`
    ).then((r) => r.json())
    setClasses(Array.isArray(data) ? data : [])
  }, [currentProject?.id])

  useEffect(() => {
    if (projectLoading) return
    if (!currentProject) { setRelations([]); setClasses([]); setLoading(false); return }
    setSelectedId(null)
    Promise.all([fetchRelations(), fetchClasses()])
  }, [currentProject?.id, projectLoading])

  useEffect(() => {
    if (initialSelectedId && relations.length > 0) {
      setSelectedId(initialSelectedId)
    }
  }, [initialSelectedId, relations.length])

  // この画面が表示状態になったら再取得する（画面はマウント維持されるため、
  // 文書取込みでリレーションを本登録した結果などを反映するのに必要）
  useEffect(() => {
    if (active && currentProject) {
      fetchRelations()
      fetchClasses()
    }
  }, [active, currentProject?.id, fetchRelations, fetchClasses])

  const fetchAllAttrs = useCallback(async (relationId: string, projectId: string) => {
    setLoadingAttrs(true)
    try {
      const [projData, ownData] = await Promise.all([
        fetch(`/api/attributes?targetId=${projectId}`).then((r) => r.json()),
        fetch(`/api/attributes?targetId=${relationId}`).then((r) => r.json()),
      ])
      setProjectAttrs(Array.isArray(projData) ? projData : [])
      setOwnAttrs(Array.isArray(ownData) ? ownData : [])
    } finally {
      setLoadingAttrs(false)
    }
  }, [])

  useEffect(() => {
    if (!selectedId || !currentProject) {
      setProjectAttrs([]); setOwnAttrs([])
      return
    }
    // 常時編集可のため、選択のたびに編集フィールドを対象リレーションで初期化する
    const rel = relations.find((r) => r.id === selectedId)
    if (rel) {
      setEditName(rel.name)
      setEditNameEn(rel.nameEn ?? "")
      setEditDesc(rel.description ?? "")
      setEditPairs(rel.classPairs ?? [])
      setEditIncludeChildren(true)
    }
    fetchAllAttrs(selectedId, currentProject.id)
  }, [selectedId, currentProject?.id])

  const handleAdd = async () => {
    if (!newName.trim() || !currentProject || newPairs.length === 0 || newPairs.some(p => !p.sourceClassId || !p.targetClassId)) return
    setAdding(true)
    try {
      const res = await fetch("/api/relations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: currentProject.id,
          name: newName.trim(),
          nameEn: newNameEn.trim(),
          description: newDesc.trim(),
          classPairs: newIncludeChildren ? expandPairs(newPairs) : newPairs,
        }),
      })
      const created: OntologyRelation = await res.json()
      await fetchRelations()
      setSelectedId(created.id)
      setShowAdd(false)
      setNewName(""); setNewNameEn(""); setNewDesc(""); setNewPairs([{ sourceClassId: "", targetClassId: "" }])
    } finally {
      setAdding(false)
    }
  }

  const addNewPair = () => setNewPairs(p => [...p, { sourceClassId: "", targetClassId: "" }])
  const removeNewPair = (i: number) => setNewPairs(p => p.filter((_, j) => j !== i))
  const updateNewPair = (i: number, field: keyof ClassPair, val: string) =>
    setNewPairs(p => p.map((pair, j) => j === i ? { ...pair, [field]: val } : pair))

  const addEditPair = () => setEditPairs(p => [...p, { sourceClassId: "", targetClassId: "" }])
  const removeEditPair = (i: number) => setEditPairs(p => p.filter((_, j) => j !== i))
  const updateEditPair = (i: number, field: keyof ClassPair, val: string) =>
    setEditPairs(p => p.map((pair, j) => j === i ? { ...pair, [field]: val } : pair))

  const handleSave = async () => {
    if (!editName.trim() || !selected || editPairs.length === 0 || editPairs.some(p => !p.sourceClassId || !p.targetClassId)) return
    setSaving(true)
    try {
      await fetch(`/api/relations/${selected.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          nameEn: editNameEn.trim(),
          description: editDesc.trim(),
          classPairs: editIncludeChildren ? expandPairs(editPairs) : editPairs,
        }),
      })
      await fetchRelations()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selected) return
    setDeleting(true)
    try {
      await fetch(`/api/relations/${selected.id}`, { method: "DELETE" })
      await fetchRelations()
      setSelectedId(null)
      setShowDelete(false)
    } finally {
      setDeleting(false)
    }
  }

  const openAddAttr = (section: AttrSectionKey) => {
    setAddAttrSection(section)
    setAttrName(""); setAttrDesc(""); setAttrDataType("文字列"); setAttrRequired("任意")
    setShowAddAttr(true)
  }

  const handleAddAttr = async () => {
    if (!attrName.trim() || !selected || !currentProject) return
    setAddingAttr(true)
    try {
      const isProject = addAttrSection === "project"
      await fetch("/api/attributes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: currentProject.id,
          name: attrName.trim(),
          description: attrDesc.trim(),
          dataType: attrDataType,
          required: attrRequired,
          scope: isProject ? "共通" : "固有",
          targetId: isProject ? currentProject.id : selected.id,
          targetType: isProject ? "project" : "relation",
        }),
      })
      await fetchAllAttrs(selected.id, currentProject.id)
      setShowAddAttr(false)
      setAttrName(""); setAttrDesc(""); setAttrDataType("文字列"); setAttrRequired("任意")
    } finally {
      setAddingAttr(false)
    }
  }

  const openEditAttr = (attr: OntologyAttribute, section: AttrSectionKey) => {
    setEditingAttr(attr)
    setEditAttrSection(section)
    setEditAttrName(attr.name)
    setEditAttrDesc(attr.description ?? "")
    setEditAttrDataType(attr.dataType)
    setEditAttrRequired(attr.required)
    setShowEditAttr(true)
  }

  const handleEditAttr = async () => {
    if (!editingAttr || !editAttrName.trim() || !selected || !currentProject) return
    setSavingAttr(true)
    try {
      await fetch(`/api/attributes/${editingAttr.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editAttrName.trim(),
          description: editAttrDesc.trim(),
          dataType: editAttrDataType,
          required: editAttrRequired,
        }),
      })
      await fetchAllAttrs(selected.id, currentProject.id)
      setShowEditAttr(false)
      setEditingAttr(null)
    } finally {
      setSavingAttr(false)
    }
  }

  const handleDeleteAttr = (attr: OntologyAttribute, section: AttrSectionKey) => {
    const doDelete = async () => {
      await fetch(`/api/attributes/${attr.id}`, { method: "DELETE" })
      if (selected && currentProject) {
        await fetchAllAttrs(selected.id, currentProject.id)
      }
    }
    const isWarning = section === "project"
    const msg = isWarning
      ? `「${attr.name}」はプロジェクト全体の共通属性です。削除するとすべてのクラス・リレーションから除去されます。`
      : `「${attr.name}」を削除します。この操作は取り消せません。`
    setAttrAlertMsg(msg)
    setAttrAlertIsWarning(isWarning)
    setPendingAttrAction({ fn: doDelete })
    setShowAttrAlert(true)
  }

  const handleExport = async () => {
    if (!currentProject || relations.length === 0) return
    setExporting(true)
    try {
      const attrsByRelationId = new Map<string, OntologyAttribute[]>()
      await Promise.all(relations.map(async (r) => {
        const attrs = await fetch(`/api/attributes?targetId=${r.id}`).then((res) => res.json())
        attrsByRelationId.set(r.id, Array.isArray(attrs) ? attrs : [])
      }))
      const classesById = new Map(classes.map((c) => [c.id, c]))
      const yamlText = buildRelationsYaml(relations, classesById, attrsByRelationId)
      downloadYaml(`relations_${currentProject.name}.yaml`, yamlText)
    } finally {
      setExporting(false)
    }
  }

  // 初回訪問（未選択）時は先頭のリレーションを自動選択する。再訪問時は前回の選択を維持する
  useEffect(() => {
    if (loading || selectedId || relations.length === 0) return
    setSelectedId(relations[0].id)
  }, [loading, selectedId, relations.length])

  const selected = relations.find((r) => r.id === selectedId)
  const className = (id: string | null) => id ? (classes.find((c) => c.id === id)?.name ?? "不明") : "—"
  // 参照先クラスが削除された（存在しない）／未設定の端点を「不明」とみなす
  const classMissing = (id: string | null | undefined) => !id || !classes.some((c) => c.id === id)

  // クラス階層：ある親クラスの子孫クラスidを再帰列挙。
  const hasChildren = (classId: string) => classes.some((c) => c.parentId === classId)
  const descendantIds = (classId: string): string[] => {
    const out: string[] = []
    const stack = classes.filter((c) => c.parentId === classId).map((c) => c.id)
    while (stack.length) {
      const id = stack.pop()!
      out.push(id)
      for (const c of classes) if (c.parentId === id) stack.push(c.id)
    }
    return out
  }
  // 親クラスを指定したペアを、その子孫クラスを含む全組合せに展開（重複除去）。
  const expandPairs = (pairs: ClassPair[]): ClassPair[] => {
    const seen = new Set<string>()
    const out: ClassPair[] = []
    for (const p of pairs) {
      if (!p.sourceClassId || !p.targetClassId) continue
      const sources = [p.sourceClassId, ...descendantIds(p.sourceClassId)]
      const targets = [p.targetClassId, ...descendantIds(p.targetClassId)]
      for (const s of sources)
        for (const t of targets) {
          const k = `${s}|${t}`
          if (!seen.has(k)) { seen.add(k); out.push({ sourceClassId: s, targetClassId: t }) }
        }
    }
    return out
  }
  // ペア群に子クラスを持つ親クラスが含まれるか（子クラス取り込みオプションの表示判定）
  const pairsHaveParent = (pairs: ClassPair[]) =>
    pairs.some((p) => (p.sourceClassId && hasChildren(p.sourceClassId)) || (p.targetClassId && hasChildren(p.targetClassId)))
  // classPairs のいずれかの端点が不明なら、定義が不完全なリレーション
  const relationIncomplete = (r: OntologyRelation) =>
    (r.classPairs ?? []).length === 0 ||
    (r.classPairs ?? []).some((p) => classMissing(p.sourceClassId) || classMissing(p.targetClassId))

  // 保存ボタンの妥当性・変更検知
  const relValid = editName.trim() !== "" && editPairs.length > 0 &&
    !editPairs.some((p) => !p.sourceClassId || !p.targetClassId)
  const relDirty = !!selected && (
    editName !== selected.name ||
    editNameEn !== (selected.nameEn ?? "") ||
    editDesc !== (selected.description ?? "") ||
    JSON.stringify(editPairs) !== JSON.stringify(selected.classPairs ?? [])
  )

  const renderAttrSection = (title: string, attrs: OntologyAttribute[], section: AttrSectionKey) => {
    const hasRows = attrs.length > 0
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
          <Button size="sm" variant="outline" className="h-7 gap-1 bg-transparent text-xs"
            onClick={() => openAddAttr(section)}>
            <Plus className="h-3 w-3" />追加
          </Button>
        </div>
        {!hasRows ? (
          <p className="rounded-lg border border-dashed border-border py-3 text-center text-xs text-muted-foreground">
            なし
          </p>
        ) : (
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="font-semibold text-foreground">属性名</TableHead>
                  <TableHead className="w-24 font-semibold text-foreground">データ型</TableHead>
                  <TableHead className="w-20 font-semibold text-foreground">必須/任意</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {attrs.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium text-foreground">
                      <div className="flex items-center gap-1.5">
                        <span>{a.name}</span>
                        {a.description && (
                          <Tooltip content={a.description}>
                            <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground/50 transition-colors hover:text-muted-foreground" />
                          </Tooltip>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{a.dataType}</TableCell>
                    <TableCell>
                      <Badge variant={a.required === "必須" ? "default" : "secondary"} className="font-normal">
                        {a.required}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-0.5">
                        <Button variant="ghost" size="icon" className="h-7 w-7"
                          onClick={() => openEditAttr(a, section)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDeleteAttr(a, section)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    )
  }

  const scopeWarningText = (section: AttrSectionKey) =>
    section === "project"
      ? "この属性はプロジェクト全体で共有されます。変更はすべてのクラス・リレーションに影響します。"
      : null

  return (
    <div className="flex h-full flex-col">
      <TopBar title="リレーション管理">
        <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-transparent"
          onClick={handleExport} disabled={!currentProject || relations.length === 0 || exporting}>
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          エクスポート
        </Button>
        <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-transparent"
          onClick={() => setShowImport(true)} disabled={!currentProject}>
          <Upload className="h-3.5 w-3.5" />インポート
        </Button>
      </TopBar>
      <div className="flex flex-1 overflow-hidden">
        {/* 一覧（表） */}
        <div className="flex flex-1 flex-col overflow-hidden border-r border-border">
          <div className="flex items-center justify-between px-6 py-3">
            <h2 className="text-base font-semibold text-foreground">リレーション一覧</h2>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-transparent"
              onClick={() => { setNewName(""); setNewNameEn(""); setNewDesc(""); setNewPairs([{ sourceClassId: "", targetClassId: "" }]); setNewIncludeChildren(true); setShowAdd(true) }}>
              <Plus className="h-3.5 w-3.5" />追加
            </Button>
          </div>
          <div className="flex-1 overflow-auto px-6 pb-6">
            {loading ? (
              <div className="flex h-32 items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : relations.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">
                {currentProject ? "リレーションが登録されていません" : "プロジェクトを選択してください"}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="w-[45%] font-semibold text-foreground">リレーション名</TableHead>
                      <TableHead className="w-[55%] font-semibold text-foreground">始点 → 終点クラス</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {relations.map((r) => {
                      const isSel = selectedId === r.id
                      const pairs = r.classPairs ?? []
                      return (
                        <TableRow
                          key={r.id}
                          className={cn(
                            "cursor-pointer transition-colors",
                            isSel
                              ? "bg-indigo-100 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-950/50"
                              : "hover:bg-muted/50",
                          )}
                          onClick={() => setSelectedId(r.id)}
                        >
                          <TableCell className="align-top">
                            <span className="flex items-center gap-1 font-medium text-foreground">
                              <span className="truncate" title={r.name}>{r.name}</span>
                              {relationIncomplete(r) && (
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
                              )}
                            </span>
                            {r.nameEn && <span className="block truncate text-xs text-muted-foreground">{r.nameEn}</span>}
                          </TableCell>
                          <TableCell className="align-top text-sm text-muted-foreground">
                            {pairs.length > 0 ? (
                              <div className="flex flex-col gap-0.5">
                                {pairs.map((p, i) => (
                                  <span key={i} className="flex items-center gap-1">
                                    <span className={cn(classMissing(p.sourceClassId) && "font-medium text-amber-600 dark:text-amber-500")}>
                                      {className(p.sourceClassId)}
                                    </span>
                                    <ArrowRight className="h-3 w-3 shrink-0" />
                                    <span className={cn(classMissing(p.targetClassId) && "font-medium text-amber-600 dark:text-amber-500")}>
                                      {className(p.targetClassId)}
                                    </span>
                                  </span>
                                ))}
                              </div>
                            ) : "—"}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>

        {/* 詳細（常に編集可・固定パネル） */}
        <div className="flex w-[30rem] shrink-0 flex-col overflow-hidden bg-card">
          {selected ? (
            <>
              <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
                {relationIncomplete(selected) && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      始点または終点のクラスが未設定、または削除されており（「不明」と表示）、このリレーション定義は不完全です。始点・終点クラスを設定し直してください。
                    </span>
                  </div>
                )}

                {/* 基本情報 */}
                <section className="space-y-3">
                  <SectionHeader icon={FileText} title="基本情報" />
                  <div className="space-y-3">
                    <div className="space-y-0.5 text-xs text-muted-foreground">
                      <p>登録日 {formatDateTime(selected.createdAt)}{selected.createdBy ? `（${selected.createdBy}）` : ""}</p>
                      <p>更新日 {formatDateTime(selected.updatedAt)}{selected.updatedBy ? `（${selected.updatedBy}）` : ""}</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">リレーション名（日本語名） <span className="text-destructive">*</span></Label>
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-8" placeholder="例：引き起こす" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">リレーション名（英語名）</Label>
                      <Input value={editNameEn} onChange={(e) => setEditNameEn(e.target.value)} className="h-8" placeholder="例：causes" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">始点・終点クラスのペア <span className="text-destructive">*</span></Label>
                      <div className="space-y-2">
                        {editPairs.map((pair, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <Select value={pair.sourceClassId || "__none__"}
                              onValueChange={(v) => updateEditPair(i, "sourceClassId", v && v !== "__none__" ? v : "")}>
                              <SelectTrigger className="h-8 min-w-0 flex-1">
                                <SelectValue>{pair.sourceClassId ? className(pair.sourceClassId) : "始点クラス"}</SelectValue>
                              </SelectTrigger>
                              <SelectContent className="max-h-72">
                                {classes.map((c) => (
                                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <ArrowRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                            <Select value={pair.targetClassId || "__none__"}
                              onValueChange={(v) => updateEditPair(i, "targetClassId", v && v !== "__none__" ? v : "")}>
                              <SelectTrigger className="h-8 min-w-0 flex-1">
                                <SelectValue>{pair.targetClassId ? className(pair.targetClassId) : "終点クラス"}</SelectValue>
                              </SelectTrigger>
                              <SelectContent className="max-h-72">
                                {classes.map((c) => (
                                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {editPairs.length > 1 && (
                              <Button size="icon" variant="ghost" className="h-8 w-8 flex-shrink-0 text-muted-foreground"
                                onClick={() => removeEditPair(i)}>
                                <X className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                      <Button size="sm" variant="outline" className="gap-1 bg-transparent" onClick={addEditPair}>
                        <Plus className="h-3.5 w-3.5" />ペアを追加
                      </Button>
                      {pairsHaveParent(editPairs) && (
                        <label className="mt-1 flex cursor-pointer items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
                          <input type="checkbox" checked={editIncludeChildren}
                            onChange={(e) => setEditIncludeChildren(e.target.checked)}
                            className="mt-0.5 h-4 w-4 accent-indigo-600" />
                          <span className="text-xs text-muted-foreground">
                            親クラスを指定したペアは、その<strong className="font-medium text-foreground">子クラスも対象に含める</strong>（推奨）。保存時に子クラス分のペアへ自動展開します。
                          </span>
                        </label>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">説明</Label>
                      <Textarea rows={4} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
                    </div>
                  </div>
                </section>

                {/* 属性 */}
                <section className="space-y-4">
                  <SectionHeader icon={Tags} title="属性" />
                  {loadingAttrs ? (
                    <div className="flex h-20 items-center justify-center text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {renderAttrSection("プロジェクト共通属性", projectAttrs, "project")}
                      {renderAttrSection("リレーション固有属性", ownAttrs, "own")}
                    </div>
                  )}
                </section>
              </div>

              {/* フッター：削除・保存 */}
              <div className="flex items-center justify-between border-t border-border px-4 py-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setShowDelete(true)}
                >
                  <Trash2 className="h-3.5 w-3.5" />削除
                </Button>
                <Button size="sm" variant="success" onClick={handleSave} disabled={!relValid || saving || !relDirty}>
                  {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}保存
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
              リレーションを選択してください
            </div>
          )}
        </div>
      </div>

      {/* リレーション追加ダイアログ */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>リレーションを追加</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>リレーション名 <span className="text-destructive">*</span></Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)}
                placeholder="例：引き起こす" />
            </div>
            <div className="space-y-2">
              <Label>英語名</Label>
              <Input value={newNameEn} onChange={(e) => setNewNameEn(e.target.value)}
                placeholder="例：causes" />
            </div>
            <div className="space-y-2">
              <Label>始点・終点クラスのペア <span className="text-destructive">*</span></Label>
              <div className="space-y-2">
                {newPairs.map((pair, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Select value={pair.sourceClassId || "__none__"}
                      onValueChange={(v) => updateNewPair(i, "sourceClassId", v && v !== "__none__" ? v : "")}>
                      <SelectTrigger className="min-w-0 flex-1">
                        <SelectValue>{pair.sourceClassId ? className(pair.sourceClassId) : "始点クラス"}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {classes.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <ArrowRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    <Select value={pair.targetClassId || "__none__"}
                      onValueChange={(v) => updateNewPair(i, "targetClassId", v && v !== "__none__" ? v : "")}>
                      <SelectTrigger className="min-w-0 flex-1">
                        <SelectValue>{pair.targetClassId ? className(pair.targetClassId) : "終点クラス"}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {classes.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {newPairs.length > 1 && (
                      <Button size="icon" variant="ghost" className="h-8 w-8 flex-shrink-0 text-muted-foreground"
                        onClick={() => removeNewPair(i)}>
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <Button size="sm" variant="outline" className="gap-1 bg-transparent"
                onClick={addNewPair}>
                <Plus className="h-3.5 w-3.5" />
                ペアを追加
              </Button>
              {pairsHaveParent(newPairs) && (
                <label className="mt-1 flex cursor-pointer items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
                  <input type="checkbox" checked={newIncludeChildren}
                    onChange={(e) => setNewIncludeChildren(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-indigo-600" />
                  <span className="text-xs text-muted-foreground">
                    親クラスを指定したペアは、その<strong className="font-medium text-foreground">子クラスも対象に含める</strong>（推奨）。登録時に子クラス分のペアへ自動展開します。
                  </span>
                </label>
              )}
            </div>
            <div className="space-y-2">
              <Label>説明</Label>
              <Textarea rows={3} value={newDesc} onChange={(e) => setNewDesc(e.target.value)}
                placeholder="リレーションの意味・用途を記述" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>キャンセル</Button>
            <Button onClick={handleAdd}
              disabled={!newName.trim() || newPairs.length === 0 || newPairs.some(p => !p.sourceClassId || !p.targetClassId) || adding}>
              {adding ? "登録中..." : "登録"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 属性追加ダイアログ */}
      <Dialog open={showAddAttr} onOpenChange={setShowAddAttr}>
        <DialogContent>
          <DialogHeader><DialogTitle>属性を追加</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {addAttrSection === "project" && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  プロジェクト全体の共通属性として追加されます。全クラス・リレーションに適用されます。
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label>属性名 <span className="text-destructive">*</span></Label>
              <Input value={attrName} onChange={(e) => setAttrName(e.target.value)} placeholder="例：備考" />
            </div>
            <div className="space-y-2">
              <Label>説明</Label>
              <Textarea rows={2} value={attrDesc} onChange={(e) => setAttrDesc(e.target.value)}
                placeholder="属性の意味・用途を記述" />
            </div>
            <div className="space-y-2">
              <Label>データ型</Label>
              <Select value={attrDataType} onValueChange={(v) => { if (v) setAttrDataType(v) }}>
                <SelectTrigger><SelectValue>{attrDataType}</SelectValue></SelectTrigger>
                <SelectContent>
                  {["文字列", "数値", "日付", "真偽値"].map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>必須／任意</Label>
              <Select value={attrRequired} onValueChange={(v) => setAttrRequired(v as AttributeRequired)}>
                <SelectTrigger><SelectValue>{attrRequired}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="必須">必須</SelectItem>
                  <SelectItem value="任意">任意</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddAttr(false)}>キャンセル</Button>
            <Button onClick={handleAddAttr} disabled={!attrName.trim() || addingAttr}>
              {addingAttr ? "追加中..." : "追加"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 属性編集ダイアログ */}
      <Dialog open={showEditAttr} onOpenChange={setShowEditAttr}>
        <DialogContent>
          <DialogHeader><DialogTitle>属性を編集</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {editAttrSection === "project" && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {scopeWarningText(editAttrSection)}
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label>属性名 <span className="text-destructive">*</span></Label>
              <Input value={editAttrName} onChange={(e) => setEditAttrName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>説明</Label>
              <Textarea rows={2} value={editAttrDesc} onChange={(e) => setEditAttrDesc(e.target.value)}
                placeholder="属性の意味・用途を記述" />
            </div>
            <div className="space-y-2">
              <Label>データ型</Label>
              <Select value={editAttrDataType} onValueChange={(v) => { if (v) setEditAttrDataType(v) }}>
                <SelectTrigger><SelectValue>{editAttrDataType}</SelectValue></SelectTrigger>
                <SelectContent>
                  {["文字列", "数値", "日付", "真偽値"].map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>必須／任意</Label>
              <Select value={editAttrRequired} onValueChange={(v) => setEditAttrRequired(v as AttributeRequired)}>
                <SelectTrigger><SelectValue>{editAttrRequired}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="必須">必須</SelectItem>
                  <SelectItem value="任意">任意</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowEditAttr(false); setEditingAttr(null) }}>
              キャンセル
            </Button>
            <Button onClick={handleEditAttr} disabled={!editAttrName.trim() || savingAttr}>
              {savingAttr ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 属性削除確認ダイアログ */}
      <Dialog open={showAttrAlert} onOpenChange={setShowAttrAlert}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {attrAlertIsWarning && <AlertTriangle className="h-5 w-5 text-amber-500" />}
              {attrAlertIsWarning ? "影響範囲の確認" : "削除の確認"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{attrAlertMsg}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAttrAlert(false); setPendingAttrAction(null) }}>
              キャンセル
            </Button>
            <Button variant="destructive" onClick={() => {
              setShowAttrAlert(false)
              pendingAttrAction?.fn()
              setPendingAttrAction(null)
            }}>
              削除する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* リレーション削除確認ダイアログ */}
      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent>
          <DialogHeader><DialogTitle>リレーションを削除</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            「{selected?.name}」を削除します。この操作は取り消せません。
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)} disabled={deleting}>
              キャンセル
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "削除中..." : "削除する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* リレーション定義インポート */}
      <ImportDialog<RelationExportItem>
        open={showImport}
        onOpenChange={setShowImport}
        title="リレーション定義をインポート"
        entityLabel="リレーション"
        parse={parseRelationsYaml}
        preview={(items, mode) => previewRelationsImport(items, relations, classes, mode)}
        onExecute={async (items, mode) => {
          if (!currentProject) throw new Error("プロジェクトが選択されていません")
          const result = await executeRelationsImport(currentProject.id, items, relations, classes, mode)
          return { created: result.created, updated: result.updated, deleted: result.deleted }
        }}
        onImported={async () => {
          setSelectedId(null)
          await fetchRelations()
        }}
      />
    </div>
  )
}
