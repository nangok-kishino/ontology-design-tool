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
import { cn } from "@/lib/utils"
import { relations } from "@/lib/ontology-data"
import type { OntologyClass, OntologyAttribute, AttributeRequired } from "@/lib/types"
import { ChevronDown, ChevronRight, Plus, Pencil, Trash2, Loader2, X, AlertTriangle } from "lucide-react"
import { useProject } from "@/app/project-context"

type TreeNode = OntologyClass & { children: TreeNode[] }
type AttrSectionKey = "project" | "parent" | "own"

function buildTree(items: OntologyClass[]): TreeNode[] {
  const map = new Map(items.map((c) => [c.id, { ...c, children: [] as TreeNode[] }]))
  const roots: TreeNode[] = []
  for (const node of map.values()) {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

function TreeItem({
  node,
  depth,
  selectedId,
  onSelect,
}: {
  node: TreeNode
  depth: number
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(true)
  const hasChildren = node.children.length > 0
  const isSelected = selectedId === node.id

  return (
    <div>
      <div
        className={cn(
          "flex cursor-pointer items-center gap-1 rounded-md py-1.5 pr-2 text-sm transition-colors",
          isSelected ? "bg-accent font-medium text-accent-foreground" : "hover:bg-muted",
        )}
        style={{ paddingLeft: depth * 16 + 8 }}
        onClick={() => onSelect(node.id)}
      >
        {hasChildren ? (
          <button
            onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
            className="flex h-4 w-4 items-center justify-center text-muted-foreground"
          >
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="h-4 w-4" />
        )}
        <span>{node.name}</span>
      </div>
      {hasChildren && open && (
        <div>
          {node.children.map((child) => (
            <TreeItem key={child.id} node={child} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  )
}

export function ClassesScreen() {
  const { currentProject, loading: projectLoading } = useProject()
  const [classes, setClasses] = useState<OntologyClass[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // クラス追加ダイアログ
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState("")
  const [newDesc, setNewDesc] = useState("")
  const [newParentId, setNewParentId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  // クラス編集モード
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState("")
  const [editDesc, setEditDesc] = useState("")
  const [editParentId, setEditParentId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // クラス削除確認ダイアログ
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // 属性 (3種)
  const [projectAttrs, setProjectAttrs] = useState<OntologyAttribute[]>([])
  const [inheritedAttrs, setInheritedAttrs] = useState<OntologyAttribute[]>([])
  const [ownAttrs, setOwnAttrs] = useState<OntologyAttribute[]>([])
  const [loadingAttrs, setLoadingAttrs] = useState(false)

  // 属性追加ダイアログ
  const [showAddAttr, setShowAddAttr] = useState(false)
  const [addAttrSection, setAddAttrSection] = useState<AttrSectionKey>("own")
  const [attrName, setAttrName] = useState("")
  const [attrDataType, setAttrDataType] = useState("文字列")
  const [attrRequired, setAttrRequired] = useState<AttributeRequired>("任意")
  const [addingAttr, setAddingAttr] = useState(false)

  // 属性編集ダイアログ
  const [showEditAttr, setShowEditAttr] = useState(false)
  const [editingAttr, setEditingAttr] = useState<OntologyAttribute | null>(null)
  const [editAttrSection, setEditAttrSection] = useState<AttrSectionKey>("own")
  const [editAttrName, setEditAttrName] = useState("")
  const [editAttrDataType, setEditAttrDataType] = useState("文字列")
  const [editAttrRequired, setEditAttrRequired] = useState<AttributeRequired>("任意")
  const [savingAttr, setSavingAttr] = useState(false)

  // スコープ警告（削除時の確認）
  const [showScopeAlert, setShowScopeAlert] = useState(false)
  const [scopeAlertMsg, setScopeAlertMsg] = useState("")
  const [scopeAlertIsWarning, setScopeAlertIsWarning] = useState(false)
  const [pendingAction, setPendingAction] = useState<{ fn: () => Promise<void> } | null>(null)

  const fetchClasses = useCallback(async () => {
    if (!currentProject) return
    setLoading(true)
    try {
      const data: OntologyClass[] = await fetch(
        `/api/classes?projectId=${currentProject.id}`
      ).then((r) => r.json())
      setClasses(data)
    } finally {
      setLoading(false)
    }
  }, [currentProject?.id])

  useEffect(() => {
    if (projectLoading) return
    if (!currentProject) { setClasses([]); setLoading(false); return }
    setSelectedId(null)
    fetchClasses()
  }, [currentProject?.id, projectLoading])

  const fetchAllAttrs = useCallback(async (classId: string, parentClassId: string | null, projectId: string) => {
    setLoadingAttrs(true)
    try {
      const [projData, ownData] = await Promise.all([
        fetch(`/api/attributes?targetId=${projectId}`).then((r) => r.json()),
        fetch(`/api/attributes?targetId=${classId}`).then((r) => r.json()),
      ])
      setProjectAttrs(Array.isArray(projData) ? projData : [])
      setOwnAttrs(Array.isArray(ownData) ? ownData : [])
      if (parentClassId) {
        const parentData = await fetch(`/api/attributes?targetId=${parentClassId}`).then((r) => r.json())
        setInheritedAttrs(Array.isArray(parentData) ? parentData : [])
      } else {
        setInheritedAttrs([])
      }
    } finally {
      setLoadingAttrs(false)
    }
  }, [])

  useEffect(() => {
    setIsEditing(false)
    if (!selectedId || !currentProject) {
      setProjectAttrs([]); setInheritedAttrs([]); setOwnAttrs([])
      return
    }
    const cls = classes.find((c) => c.id === selectedId)
    fetchAllAttrs(selectedId, cls?.parentId ?? null, currentProject.id)
  }, [selectedId, currentProject?.id])

  const handleAdd = async () => {
    if (!newName.trim() || !currentProject) return
    setAdding(true)
    try {
      const res = await fetch("/api/classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: currentProject.id,
          name: newName.trim(),
          description: newDesc.trim(),
          parentId: newParentId,
        }),
      })
      const created: OntologyClass = await res.json()
      await fetchClasses()
      setSelectedId(created.id)
      setShowAdd(false)
      setNewName(""); setNewDesc(""); setNewParentId(null)
    } finally {
      setAdding(false)
    }
  }

  const startEdit = () => {
    if (!selected) return
    setEditName(selected.name)
    setEditDesc(selected.description)
    setEditParentId(selected.parentId)
    setIsEditing(true)
  }

  const handleSave = async () => {
    if (!editName.trim() || !selected) return
    setSaving(true)
    try {
      await fetch(`/api/classes/${selected.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDesc.trim(),
          parentId: editParentId,
        }),
      })
      await fetchClasses()
      setIsEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (mode: "simple" | "cascade" | "promote") => {
    if (!selected) return
    setDeleting(true)
    try {
      const children = classes.filter((c) => c.parentId === selected.id)
      if (mode === "cascade") {
        await Promise.all(
          children.map((child) => fetch(`/api/classes/${child.id}`, { method: "DELETE" }))
        )
      } else if (mode === "promote") {
        await Promise.all(
          children.map((child) =>
            fetch(`/api/classes/${child.id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ parentId: null }),
            })
          )
        )
      }
      await fetch(`/api/classes/${selected.id}`, { method: "DELETE" })
      await fetchClasses()
      setSelectedId(null)
      setShowDelete(false)
    } finally {
      setDeleting(false)
    }
  }

  // 属性追加ダイアログを開く
  const openAddAttr = (section: AttrSectionKey) => {
    setAddAttrSection(section)
    setAttrName("")
    setAttrDataType("文字列")
    setAttrRequired("任意")
    setShowAddAttr(true)
  }

  const handleAddAttr = async () => {
    if (!attrName.trim() || !selected || !currentProject) return
    setAddingAttr(true)
    try {
      let targetId: string
      let targetType: "project" | "class"
      let scope: "共通" | "固有"

      if (addAttrSection === "project") {
        targetId = currentProject.id; targetType = "project"; scope = "共通"
      } else if (addAttrSection === "parent") {
        targetId = selected.parentId!; targetType = "class"; scope = "固有"
      } else {
        targetId = selected.id; targetType = "class"; scope = "固有"
      }

      await fetch("/api/attributes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: currentProject.id,
          name: attrName.trim(),
          dataType: attrDataType,
          required: attrRequired,
          scope,
          targetId,
          targetType,
        }),
      })
      await fetchAllAttrs(selected.id, selected.parentId, currentProject.id)
      setShowAddAttr(false)
      setAttrName(""); setAttrDataType("文字列"); setAttrRequired("任意")
    } finally {
      setAddingAttr(false)
    }
  }

  // 属性編集ダイアログを開く
  const openEditAttr = (attr: OntologyAttribute, section: AttrSectionKey) => {
    setEditingAttr(attr)
    setEditAttrSection(section)
    setEditAttrName(attr.name)
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
          dataType: editAttrDataType,
          required: editAttrRequired,
        }),
      })
      await fetchAllAttrs(selected.id, selected.parentId, currentProject.id)
      setShowEditAttr(false)
      setEditingAttr(null)
    } finally {
      setSavingAttr(false)
    }
  }

  // 削除: スコープ外なら確認ダイアログ経由
  const handleDeleteAttr = (attr: OntologyAttribute, section: AttrSectionKey) => {
    const doDelete = async () => {
      await fetch(`/api/attributes/${attr.id}`, { method: "DELETE" })
      if (selected && currentProject) {
        await fetchAllAttrs(selected.id, selected.parentId, currentProject.id)
      }
    }

    const isWarning = section !== "own"
    const msg = section === "project"
      ? `「${attr.name}」はプロジェクト全体の共通属性です。削除するとすべてのクラスから除去されます。`
      : section === "parent"
      ? `「${attr.name}」は「${parentName}」クラスの属性です。削除するとそのクラス全体に影響します。`
      : `「${attr.name}」を削除します。この操作は取り消せません。`
    setScopeAlertMsg(msg)
    setScopeAlertIsWarning(isWarning)
    setPendingAction({ fn: doDelete })
    setShowScopeAlert(true)
  }

  const openAddDialog = () => {
    setNewName(""); setNewDesc(""); setNewParentId(null)
    setShowAdd(true)
  }

  const tree = buildTree(classes)
  const selected = classes.find((c) => c.id === selectedId)
  const childClasses = selected ? classes.filter((c) => c.parentId === selected.id) : []
  const hasChildren = childClasses.length > 0
  const parentClass = selected?.parentId ? classes.find((c) => c.id === selected.parentId) : null
  const parentName = parentClass?.name ?? "なし"
  const relatedRelations = selected
    ? relations.filter((r) => r.sourceClass === selected.name || r.targetClass === selected.name)
    : []

  const parentCandidates = classes.filter((c) => c.parentId === null && c.id !== selectedId)
  const addParentCandidates = classes.filter((c) => c.parentId === null)

  // 属性セクションのレンダリング
  const renderAttrSection = (
    title: string,
    attrs: OntologyAttribute[],
    section: AttrSectionKey,
  ) => (
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
                  <TableCell className="font-medium text-foreground">{a.name}</TableCell>
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

  const scopeWarningText = (section: AttrSectionKey): string | null => {
    if (section === "project") return "この属性はプロジェクト全体で共有されます。変更はすべてのクラスに影響します。"
    if (section === "parent") return `この属性は「${parentName}」クラスの属性です。変更はそのクラス全体に影響します。`
    return null
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar title="クラス管理" />
      <div className="grid flex-1 grid-cols-3 overflow-hidden">
        {/* 左ペイン */}
        <div className="col-span-1 flex flex-col border-r border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">クラス一覧</h2>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-transparent"
              onClick={openAddDialog}>
              <Plus className="h-3.5 w-3.5" />クラスを追加
            </Button>
          </div>
          <div className="flex-1 overflow-auto p-2">
            {loading ? (
              <div className="flex h-32 items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : tree.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">
                {currentProject ? "クラスが登録されていません" : "プロジェクトを選択してください"}
              </p>
            ) : (
              tree.map((node) => (
                <TreeItem key={node.id} node={node} depth={0} selectedId={selectedId} onSelect={setSelectedId} />
              ))
            )}
          </div>
        </div>

        {/* 右ペイン */}
        {selected ? (
          <div className="col-span-2 flex flex-col overflow-hidden">
            {/* ヘッダー */}
            <div className="flex items-center justify-between border-b border-border px-6 py-3">
              <h2 className="text-base font-semibold text-foreground">{selected.name}</h2>
              <div className="flex gap-2">
                {isEditing ? (
                  <>
                    <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-transparent"
                      onClick={() => setIsEditing(false)}>
                      <X className="h-3.5 w-3.5" />キャンセル
                    </Button>
                    <Button size="sm" className="h-8 gap-1.5"
                      onClick={handleSave} disabled={!editName.trim() || saving}>
                      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      {saving ? "保存中..." : "保存"}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-transparent"
                      onClick={startEdit}>
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

            <div className="flex-1 overflow-auto p-6">
              <Tabs defaultValue="basic">
                <TabsList>
                  <TabsTrigger value="basic">基本情報</TabsTrigger>
                  <TabsTrigger value="attributes">属性</TabsTrigger>
                  <TabsTrigger value="relations">関連リレーション</TabsTrigger>
                </TabsList>

                {/* 基本情報 */}
                <TabsContent value="basic" className="mt-6 max-w-xl space-y-5">
                  {isEditing ? (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="edit-name">クラス名 <span className="text-destructive">*</span></Label>
                        <Input id="edit-name" value={editName}
                          onChange={(e) => setEditName(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="edit-desc">説明</Label>
                        <Textarea id="edit-desc" rows={4} value={editDesc}
                          onChange={(e) => setEditDesc(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="edit-parent">親クラス</Label>
                        <Select
                          value={editParentId ?? "__none__"}
                          onValueChange={(v) => setEditParentId(v === "__none__" ? null : v)}
                        >
                          <SelectTrigger id="edit-parent">
                            <SelectValue>
                              {editParentId
                                ? (parentCandidates.find(c => c.id === editParentId)?.name ?? editParentId)
                                : "なし"}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">なし</SelectItem>
                            {parentCandidates.map((c) => (
                              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">クラス名</Label>
                        <p className="text-sm font-medium text-foreground">{selected.name}</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">説明</Label>
                        <p className="text-sm text-foreground whitespace-pre-wrap">
                          {selected.description || "（説明なし）"}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">親クラス</Label>
                        <p className="text-sm text-foreground">{parentName}</p>
                      </div>
                    </>
                  )}
                </TabsContent>

                {/* 属性タブ */}
                <TabsContent value="attributes" className="mt-6">
                  {loadingAttrs ? (
                    <div className="flex h-20 items-center justify-center text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {renderAttrSection("プロジェクト共通属性", projectAttrs, "project")}
                      {selected.parentId && renderAttrSection(
                        `継承属性（${parentName}）`,
                        inheritedAttrs,
                        "parent"
                      )}
                      {renderAttrSection("クラス固有属性", ownAttrs, "own")}
                    </div>
                  )}
                </TabsContent>

                {/* 関連リレーション */}
                <TabsContent value="relations" className="mt-6">
                  <div className="rounded-lg border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>始点クラス</TableHead>
                          <TableHead>リレーション名</TableHead>
                          <TableHead>終点クラス</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {relatedRelations.length > 0 ? (
                          relatedRelations.map((r) => (
                            <TableRow key={r.id}>
                              <TableCell className="text-foreground">{r.sourceClass}</TableCell>
                              <TableCell className="font-medium text-foreground">{r.name}</TableCell>
                              <TableCell className="text-foreground">{r.targetClass}</TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow>
                            <TableCell colSpan={3} className="text-center text-muted-foreground">
                              関連するリレーションはありません
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        ) : (
          !loading && (
            <div className="col-span-2 flex items-center justify-center text-muted-foreground">
              <p className="text-sm">クラスを選択してください</p>
            </div>
          )
        )}
      </div>

      {/* クラス追加ダイアログ */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>クラスを追加</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="cls-name">クラス名 <span className="text-destructive">*</span></Label>
              <Input id="cls-name" value={newName} onChange={(e) => setNewName(e.target.value)}
                placeholder="例：不具合事例"
                onKeyDown={(e) => e.key === "Enter" && !adding && handleAdd()} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cls-desc">説明</Label>
              <Textarea id="cls-desc" value={newDesc} onChange={(e) => setNewDesc(e.target.value)}
                rows={3} placeholder="クラスの定義・用途を記述" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cls-parent">親クラス</Label>
              <Select value={newParentId ?? "__none__"}
                onValueChange={(v) => setNewParentId(v === "__none__" ? null : v)}>
                <SelectTrigger id="cls-parent">
                  <SelectValue>
                    {newParentId
                      ? (addParentCandidates.find(c => c.id === newParentId)?.name ?? newParentId)
                      : "なし"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">なし</SelectItem>
                  {addParentCandidates.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>キャンセル</Button>
            <Button onClick={handleAdd} disabled={!newName.trim() || adding}>
              {adding ? "登録中..." : "登録"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 属性追加ダイアログ */}
      <Dialog open={showAddAttr} onOpenChange={setShowAddAttr}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>属性を追加</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {addAttrSection !== "own" && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {addAttrSection === "project"
                    ? "プロジェクト全体の共通属性として追加されます。全クラスに適用されます。"
                    : `「${parentName}」クラスへ追加されます。そのクラス全体に影響します。`}
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="attr-name">属性名 <span className="text-destructive">*</span></Label>
              <Input id="attr-name" value={attrName} onChange={(e) => setAttrName(e.target.value)}
                placeholder="例：登録日" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="attr-dtype">データ型</Label>
              <Select value={attrDataType} onValueChange={(v) => { if (v) setAttrDataType(v) }}>
                <SelectTrigger id="attr-dtype">
                  <SelectValue>{attrDataType}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {["文字列", "数値", "日時", "真偽値"].map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="attr-req">必須／任意</Label>
              <Select value={attrRequired} onValueChange={(v) => setAttrRequired(v as AttributeRequired)}>
                <SelectTrigger id="attr-req">
                  <SelectValue>{attrRequired}</SelectValue>
                </SelectTrigger>
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
          <DialogHeader>
            <DialogTitle>属性を編集</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {editAttrSection !== "own" && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {scopeWarningText(editAttrSection)}
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="edit-attr-name">属性名 <span className="text-destructive">*</span></Label>
              <Input id="edit-attr-name" value={editAttrName}
                onChange={(e) => setEditAttrName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-attr-dtype">データ型</Label>
              <Select value={editAttrDataType} onValueChange={(v) => { if (v) setEditAttrDataType(v) }}>
                <SelectTrigger id="edit-attr-dtype">
                  <SelectValue>{editAttrDataType}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {["文字列", "数値", "日時", "真偽値"].map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-attr-req">必須／任意</Label>
              <Select value={editAttrRequired} onValueChange={(v) => setEditAttrRequired(v as AttributeRequired)}>
                <SelectTrigger id="edit-attr-req">
                  <SelectValue>{editAttrRequired}</SelectValue>
                </SelectTrigger>
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

      {/* スコープ警告確認ダイアログ（削除時） */}
      <Dialog open={showScopeAlert} onOpenChange={setShowScopeAlert}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {scopeAlertIsWarning && <AlertTriangle className="h-5 w-5 text-amber-500" />}
              {scopeAlertIsWarning ? "影響範囲の確認" : "削除の確認"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{scopeAlertMsg}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowScopeAlert(false); setPendingAction(null) }}>
              キャンセル
            </Button>
            <Button variant="destructive" onClick={() => {
              setShowScopeAlert(false)
              pendingAction?.fn()
              setPendingAction(null)
            }}>
              削除する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* クラス削除確認ダイアログ */}
      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>クラスを削除</DialogTitle>
          </DialogHeader>
          {hasChildren ? (
            <>
              <p className="text-sm text-muted-foreground">
                「{selected?.name}」には子クラスが{childClasses.length}つあります。削除方法を選択してください。
              </p>
              <ul className="ml-4 list-disc text-sm text-muted-foreground">
                {childClasses.map((c) => <li key={c.id}>{c.name}</li>)}
              </ul>
              <div className="mt-2 flex flex-col gap-2">
                <Button className="w-full" variant="destructive"
                  onClick={() => handleDelete("cascade")} disabled={deleting}>
                  {deleting ? "処理中..." : "子クラスも一緒に削除"}
                </Button>
                <Button className="w-full border-destructive text-destructive hover:bg-destructive/10"
                  variant="outline"
                  onClick={() => handleDelete("promote")} disabled={deleting}>
                  {deleting ? "処理中..." : "子クラスをなしに残して削除"}
                </Button>
                <Button className="w-full" variant="outline"
                  onClick={() => setShowDelete(false)} disabled={deleting}>
                  キャンセル
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                「{selected?.name}」を削除します。この操作は取り消せません。
              </p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowDelete(false)} disabled={deleting}>
                  キャンセル
                </Button>
                <Button variant="destructive"
                  onClick={() => handleDelete("simple")} disabled={deleting}>
                  {deleting ? "削除中..." : "削除する"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
