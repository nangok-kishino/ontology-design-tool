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
import { sampleAttributes, relations } from "@/lib/ontology-data"
import type { OntologyClass } from "@/lib/types"
import { ChevronDown, ChevronRight, Plus, Pencil, Trash2, Loader2, X } from "lucide-react"
import { useProject } from "@/app/project-context"

type TreeNode = OntologyClass & { children: TreeNode[] }

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

  // 追加ダイアログ
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState("")
  const [newDesc, setNewDesc] = useState("")
  const [newParentId, setNewParentId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  // 編集モード
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState("")
  const [editDesc, setEditDesc] = useState("")
  const [editParentId, setEditParentId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // 削除確認ダイアログ
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

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

  // クラス選択が変わったら編集モードを抜ける
  useEffect(() => {
    setIsEditing(false)
  }, [selectedId])

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

  const openAddDialog = () => {
    setNewName("")
    setNewDesc("")
    setNewParentId(null)
    setShowAdd(true)
  }

  const tree = buildTree(classes)
  const selected = classes.find((c) => c.id === selectedId)
  const childClasses = selected ? classes.filter((c) => c.parentId === selected.id) : []
  const hasChildren = childClasses.length > 0
  const parentName = selected?.parentId
    ? (classes.find((c) => c.id === selected.parentId)?.name ?? "なし")
    : "なし"
  const relatedRelations = selected
    ? relations.filter((r) => r.sourceClass === selected.name || r.targetClass === selected.name)
    : []

  // 親クラス候補：なしのみ、自分自身を除く
  const parentCandidates = classes.filter(
    (c) => c.parentId === null && c.id !== selectedId
  )
  const addParentCandidates = classes.filter((c) => c.parentId === null)

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

                {/* 基本情報：表示 / 編集で切替 */}
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

                <TabsContent value="attributes" className="mt-6">
                  <div className="mb-3 flex justify-end">
                    <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-transparent">
                      <Plus className="h-3.5 w-3.5" />属性を追加
                    </Button>
                  </div>
                  <div className="rounded-lg border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>属性名</TableHead>
                          <TableHead>データ型</TableHead>
                          <TableHead>必須／任意</TableHead>
                          <TableHead>共通／固有</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sampleAttributes.map((a) => (
                          <TableRow key={a.id}>
                            <TableCell className="font-medium text-foreground">{a.name}</TableCell>
                            <TableCell className="text-muted-foreground">{a.dataType}</TableCell>
                            <TableCell>
                              <Badge variant={a.required === "必須" ? "default" : "secondary"} className="font-normal">
                                {a.required}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground">{a.scope}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

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

      {/* 削除確認ダイアログ */}
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
