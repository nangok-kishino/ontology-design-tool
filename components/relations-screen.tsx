"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
import { cn } from "@/lib/utils"
import type { OntologyRelation, OntologyClass, OntologyAttribute, AttributeRequired } from "@/lib/types"
import { ArrowRight, Plus, Pencil, Trash2, Loader2, X, AlertTriangle, Info } from "lucide-react"
import { useProject } from "@/app/project-context"

type AttrSectionKey = "project" | "own"

export function RelationsScreen() {
  const { currentProject, loading: projectLoading } = useProject()
  const [relations, setRelations] = useState<OntologyRelation[]>([])
  const [classes, setClasses] = useState<OntologyClass[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // リレーション追加ダイアログ
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState("")
  const [newDesc, setNewDesc] = useState("")
  const [newSourceId, setNewSourceId] = useState<string | null>(null)
  const [newTargetId, setNewTargetId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  // 編集モード
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState("")
  const [editDesc, setEditDesc] = useState("")
  const [editSourceId, setEditSourceId] = useState<string | null>(null)
  const [editTargetId, setEditTargetId] = useState<string | null>(null)
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
    if (!newName.trim() || !newSourceId || !newTargetId || !currentProject) return
    setAdding(true)
    try {
      const res = await fetch("/api/relations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: currentProject.id,
          name: newName.trim(),
          description: newDesc.trim(),
          sourceClassId: newSourceId,
          targetClassId: newTargetId,
        }),
      })
      const created: OntologyRelation = await res.json()
      await fetchRelations()
      setSelectedId(created.id)
      setShowAdd(false)
      setNewName(""); setNewDesc(""); setNewSourceId(null); setNewTargetId(null)
    } finally {
      setAdding(false)
    }
  }

  const startEdit = () => {
    if (!selected) return
    setEditName(selected.name)
    setEditDesc(selected.description)
    setEditSourceId(selected.sourceClassId)
    setEditTargetId(selected.targetClassId)
    setIsEditing(true)
  }

  const handleSave = async () => {
    if (!editName.trim() || !editSourceId || !editTargetId || !selected) return
    setSaving(true)
    try {
      await fetch(`/api/relations/${selected.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDesc.trim(),
          sourceClassId: editSourceId,
          targetClassId: editTargetId,
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

  const selected = relations.find((r) => r.id === selectedId)
  const className = (id: string | null) => id ? (classes.find((c) => c.id === id)?.name ?? "不明") : "—"

  const renderAttrSection = (title: string, attrs: OntologyAttribute[], section: AttrSectionKey) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
        <Button size="sm" variant="outline" className="h-7 gap-1 bg-transparent text-xs"
          onClick={() => openAddAttr(section)}>
          <Plus className="h-3 w-3" />追加
        </Button>
      </div>
      {attrs.length === 0 ? (
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

  const scopeWarningText = (section: AttrSectionKey) =>
    section === "project"
      ? "この属性はプロジェクト全体で共有されます。変更はすべてのクラス・リレーションに影響します。"
      : null

  return (
    <div className="flex h-full flex-col">
      <TopBar title="リレーション管理" />
      <div className="grid flex-1 overflow-hidden" style={{ gridTemplateColumns: "260px 1fr" }}>
        {/* 左ペイン */}
        <div className="flex flex-col border-r border-border bg-card">
          <div className="flex items-center justify-between px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">リレーション一覧</h2>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-transparent"
              onClick={() => { setNewName(""); setNewDesc(""); setNewSourceId(null); setNewTargetId(null); setShowAdd(true) }}>
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
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      {className(r.sourceClassId)}
                      <ArrowRight className="h-3 w-3" />
                      {className(r.targetClassId)}
                    </span>
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
                  <span>{className(selected.sourceClassId)}</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                  <span>{className(selected.targetClassId)}</span>
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
                      onClick={handleSave} disabled={!editName.trim() || !editSourceId || !editTargetId || saving}>
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

            <div className="flex-1 overflow-auto">
              <Tabs defaultValue="basic">
                <div className="border-b border-border px-6 pt-3">
                  <TabsList variant="line" className="h-auto w-auto justify-start border-0 p-0 gap-0">
                    <TabsTrigger value="basic" className="h-auto flex-none rounded-t-sm rounded-b-none px-5 py-2 text-sm border-b-2 border-b-transparent after:hidden hover:bg-muted/50 data-active:bg-accent data-active:text-accent-foreground data-active:border-b-primary">基本情報</TabsTrigger>
                    <TabsTrigger value="attributes" className="h-auto flex-none rounded-t-sm rounded-b-none px-5 py-2 text-sm border-b-2 border-b-transparent after:hidden hover:bg-muted/50 data-active:bg-accent data-active:text-accent-foreground data-active:border-b-primary">属性</TabsTrigger>
                  </TabsList>
                </div>

                {/* 基本情報 */}
                <TabsContent value="basic" className="px-6 py-6 max-w-xl space-y-5">
                  {isEditing ? (
                    <>
                      <div className="space-y-2">
                        <Label>リレーション名 <span className="text-destructive">*</span></Label>
                        <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>始点クラス <span className="text-destructive">*</span></Label>
                          <Select value={editSourceId ?? "__none__"}
                            onValueChange={(v) => setEditSourceId(v === "__none__" ? null : v)}>
                            <SelectTrigger>
                              <SelectValue>
                                {editSourceId ? className(editSourceId) : "選択してください"}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {classes.map((c) => (
                                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>終点クラス <span className="text-destructive">*</span></Label>
                          <Select value={editTargetId ?? "__none__"}
                            onValueChange={(v) => setEditTargetId(v === "__none__" ? null : v)}>
                            <SelectTrigger>
                              <SelectValue>
                                {editTargetId ? className(editTargetId) : "選択してください"}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {classes.map((c) => (
                                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
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
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">始点クラス</Label>
                          <p className="text-sm text-foreground">{className(selected.sourceClassId)}</p>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">終点クラス</Label>
                          <p className="text-sm text-foreground">{className(selected.targetClassId)}</p>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">説明</Label>
                        <p className="text-sm text-foreground whitespace-pre-wrap">
                          {selected.description || "（説明なし）"}
                        </p>
                      </div>
                    </>
                  )}
                </TabsContent>

                {/* 属性タブ */}
                <TabsContent value="attributes" className="px-6 py-6">
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
                </TabsContent>
              </Tabs>
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
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>始点クラス <span className="text-destructive">*</span></Label>
                <Select value={newSourceId ?? "__none__"}
                  onValueChange={(v) => setNewSourceId(v === "__none__" ? null : v)}>
                  <SelectTrigger>
                    <SelectValue>
                      {newSourceId ? className(newSourceId) : "選択してください"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {classes.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>終点クラス <span className="text-destructive">*</span></Label>
                <Select value={newTargetId ?? "__none__"}
                  onValueChange={(v) => setNewTargetId(v === "__none__" ? null : v)}>
                  <SelectTrigger>
                    <SelectValue>
                      {newTargetId ? className(newTargetId) : "選択してください"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {classes.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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
              disabled={!newName.trim() || !newSourceId || !newTargetId || adding}>
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
    </div>
  )
}
