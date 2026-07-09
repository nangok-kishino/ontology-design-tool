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
import { ArrowRight, Plus, Pencil, Trash2, Loader2, X, AlertTriangle, Info, Lock, Download, Upload, FileText, Tags } from "lucide-react"
import { useProject } from "@/app/project-context"

type AttrSectionKey = "project" | "own"

const SYSTEM_ATTRS = [
  { name: "登録日", dataType: "日付", required: "必須", description: "レコードが初めて登録された日付（システム自動付与）" },
  { name: "登録者", dataType: "文字列", required: "必須", description: "レコードを最初に登録したユーザー（システム自動付与）" },
  { name: "更新日", dataType: "日付", required: "必須", description: "レコードが最後に更新された日付（システム自動付与）" },
  { name: "更新者", dataType: "文字列", required: "必須", description: "レコードを最後に更新したユーザー（システム自動付与）" },
] as const

export function RelationsScreen({ initialSelectedId }: { initialSelectedId?: string }) {
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
  const [adding, setAdding] = useState(false)

  // 編集モード
  const [isEditing, setIsEditing] = useState(false)
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
    setIsEditing(false)
    if (!selectedId || !currentProject) {
      setProjectAttrs([]); setOwnAttrs([])
      return
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
          classPairs: newPairs,
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

  const startEdit = () => {
    if (!selected) return
    setEditName(selected.name)
    setEditNameEn(selected.nameEn ?? "")
    setEditDesc(selected.description)
    setEditPairs(selected.classPairs ?? [])
    setIsEditing(true)
  }

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
          classPairs: editPairs,
        }),
      })
      await fetchRelations()
      setIsEditing(false)
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

  const selected = relations.find((r) => r.id === selectedId)
  const className = (id: string | null) => id ? (classes.find((c) => c.id === id)?.name ?? "不明") : "—"

  const renderAttrSection = (title: string, attrs: OntologyAttribute[], section: AttrSectionKey) => {
    const isProject = section === "project"
    const hasRows = isProject || attrs.length > 0
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
                {isProject && SYSTEM_ATTRS.map((s) => (
                  <TableRow key={`sys-${s.name}`} className="bg-muted/20">
                    <TableCell className="font-medium text-foreground">
                      <div className="flex items-center gap-1.5">
                        <Lock className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                        <span>{s.name}</span>
                        <Tooltip content={s.description}>
                          <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground/50 transition-colors hover:text-muted-foreground" />
                        </Tooltip>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{s.dataType}</TableCell>
                    <TableCell>
                      <Badge variant="default" className="font-normal">{s.required}</Badge>
                    </TableCell>
                    <TableCell />
                  </TableRow>
                ))}
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
      <div className="grid flex-1 overflow-hidden" style={{ gridTemplateColumns: "260px 1fr" }}>
        {/* 左ペイン */}
        <div className="flex flex-col border-r border-border bg-card">
          <div className="flex items-center justify-between px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">リレーション一覧</h2>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-transparent"
              onClick={() => { setNewName(""); setNewNameEn(""); setNewDesc(""); setNewPairs([{ sourceClassId: "", targetClassId: "" }]); setShowAdd(true) }}>
              <Plus className="h-3.5 w-3.5" />追加
            </Button>
          </div>
          <div className="flex-1 overflow-auto p-2">
            {loading ? (
              <div className="flex h-32 items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : relations.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">
                {currentProject ? "リレーションが登録されていません" : "プロジェクトを選択してください"}
              </p>
            ) : (
              relations.map((r) => {
                const isSelected = selectedId === r.id
                return (
                  <button
                    key={r.id}
                    onClick={() => setSelectedId(r.id)}
                    className={cn(
                      "flex w-full flex-col gap-0.5 rounded-md px-3 py-2.5 text-left text-sm transition-colors",
                      isSelected ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                    )}
                  >
                    <span className="font-medium text-foreground">{r.name}</span>
                    {r.nameEn && <span className="text-xs text-muted-foreground">{r.nameEn}</span>}
                    {(r.classPairs ?? []).map((p, i) => (
                      <span key={i} className="flex items-center gap-1 text-xs text-muted-foreground">
                        {className(p.sourceClassId)}
                        <ArrowRight className="h-3 w-3" />
                        {className(p.targetClassId)}
                      </span>
                    ))}
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* 右ペイン */}
        {selected ? (
          <div className="flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-3">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-foreground">{selected.name}</h2>
                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                  {(selected.classPairs ?? []).slice(0, 1).map((p, i) => (
                    <span key={i} className="flex items-center gap-1">
                      <span>{className(p.sourceClassId)}</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                      <span>{className(p.targetClassId)}</span>
                    </span>
                  ))}
                  {(selected.classPairs ?? []).length > 1 && (
                    <span className="ml-1 text-xs">+{selected.classPairs.length - 1}</span>
                  )}
                </span>
              </div>
              <div className="flex gap-2">
                {isEditing ? (
                  <>
                    <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-transparent"
                      onClick={() => setIsEditing(false)}>
                      <X className="h-3.5 w-3.5" />キャンセル
                    </Button>
                    <Button size="sm" className="h-8 gap-1.5"
                      onClick={handleSave} disabled={!editName.trim() || editPairs.length === 0 || editPairs.some(p => !p.sourceClassId || !p.targetClassId) || saving}>
                      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      {saving ? "保存中..." : "保存"}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-transparent" onClick={startEdit}>
                      <Pencil className="h-3.5 w-3.5" />編集
                    </Button>
                    <Button size="sm" variant="outline"
                      className="h-8 gap-1.5 bg-transparent text-destructive hover:text-destructive"
                      onClick={() => setShowDelete(true)}>
                      <Trash2 className="h-3.5 w-3.5" />削除
                    </Button>
                  </>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-auto px-6 py-6 space-y-8">
                {/* 基本情報 */}
                <div className="space-y-5 max-w-xl">
                  <SectionHeader icon={FileText} title="基本情報" />
                  {isEditing ? (
                    <>
                      <div className="space-y-2">
                        <Label>リレーション名 <span className="text-destructive">*</span></Label>
                        <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label>英語名</Label>
                        <Input value={editNameEn} onChange={(e) => setEditNameEn(e.target.value)}
                          placeholder="例：causes" />
                      </div>
                      <div className="space-y-2">
                        <Label>始点・終点クラスのペア <span className="text-destructive">*</span></Label>
                        <div className="space-y-2">
                          {editPairs.map((pair, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <Select value={pair.sourceClassId || "__none__"}
                                onValueChange={(v) => updateEditPair(i, "sourceClassId", v && v !== "__none__" ? v : "")}>
                                <SelectTrigger className="flex-1">
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
                                onValueChange={(v) => updateEditPair(i, "targetClassId", v && v !== "__none__" ? v : "")}>
                                <SelectTrigger className="flex-1">
                                  <SelectValue>{pair.targetClassId ? className(pair.targetClassId) : "終点クラス"}</SelectValue>
                                </SelectTrigger>
                                <SelectContent>
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
                        <Button size="sm" variant="outline" className="gap-1 bg-transparent"
                          onClick={addEditPair}>
                          <Plus className="h-3.5 w-3.5" />
                          ペアを追加
                        </Button>
                      </div>
                      <div className="space-y-2">
                        <Label>説明</Label>
                        <Textarea rows={4} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">リレーション名</Label>
                        <p className="text-sm font-medium text-foreground">{selected.name}</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">始点・終点クラスのペア</Label>
                        {(selected.classPairs ?? []).map((p, i) => (
                          <div key={i} className="flex items-center gap-2 text-sm text-foreground">
                            <span>{className(p.sourceClassId)}</span>
                            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>{className(p.targetClassId)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">説明</Label>
                        <p className="text-sm text-foreground whitespace-pre-wrap">
                          {selected.description || "（説明なし）"}
                        </p>
                      </div>
                    </>
                  )}
                </div>

                {/* 属性 */}
                <div className="space-y-4">
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
                </div>
            </div>
          </div>
        ) : (
          !loading && (
            <div className="flex items-center justify-center text-muted-foreground">
              <p className="text-sm">リレーションを選択してください</p>
            </div>
          )
        )}
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
                      <SelectTrigger className="flex-1">
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
                      <SelectTrigger className="flex-1">
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
