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
import type { OntologyClass, OntologyAttribute, OntologyRelation, AttributeRequired } from "@/lib/types"
import {
  buildClassesYaml,
  downloadYaml,
  parseClassesYaml,
  previewClassesImport,
  executeClassesImport,
  type ClassExportItem,
} from "@/lib/import-export"
import { Plus, Pencil, Trash2, Loader2, AlertTriangle, Info, Download, Upload, FileText, Tags, Link2 } from "lucide-react"
import { useProject } from "@/app/project-context"

type TreeNode = OntologyClass & { children: TreeNode[] }
type AttrSectionKey = "project" | "parent" | "own"

function formatDateTime(iso: string | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
}

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

export function ClassesScreen({ initialSelectedId, active }: { initialSelectedId?: string; active?: boolean }) {
  const { currentProject, loading: projectLoading } = useProject()
  const [classes, setClasses] = useState<OntologyClass[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // クラス追加ダイアログ
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState("")
  const [newNameEn, setNewNameEn] = useState("")
  const [newDesc, setNewDesc] = useState("")
  const [newParentId, setNewParentId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  // クラス編集（右詳細パネルで常時編集可）
  const [editName, setEditName] = useState("")
  const [editNameEn, setEditNameEn] = useState("")
  const [editDesc, setEditDesc] = useState("")
  const [editParentId, setEditParentId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // クラス削除確認ダイアログ
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteInstanceCount, setDeleteInstanceCount] = useState(0)
  const [loadingDeleteInfo, setLoadingDeleteInfo] = useState(false)
  const [deleteChildMode, setDeleteChildMode] = useState<"cascade" | "promote">("promote")
  const [deleteInstanceMode, setDeleteInstanceMode] = useState<"delete" | "unclassify">("unclassify")

  // リレーション
  const [relations, setRelations] = useState<OntologyRelation[]>([])

  // 属性 (3種)
  const [projectAttrs, setProjectAttrs] = useState<OntologyAttribute[]>([])
  const [inheritedAttrs, setInheritedAttrs] = useState<OntologyAttribute[]>([])
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

  // スコープ警告（削除時の確認）
  const [showScopeAlert, setShowScopeAlert] = useState(false)
  const [scopeAlertMsg, setScopeAlertMsg] = useState("")
  const [scopeAlertIsWarning, setScopeAlertIsWarning] = useState(false)
  const [pendingAction, setPendingAction] = useState<{ fn: () => Promise<void> } | null>(null)

  const fetchClasses = useCallback(async () => {
    if (!currentProject) return
    setLoading(true)
    try {
      const [classData, relData] = await Promise.all([
        fetch(`/api/classes?projectId=${currentProject.id}`).then((r) => r.json()),
        fetch(`/api/relations?projectId=${currentProject.id}`).then((r) => r.json()),
      ])
      setClasses(classData)
      setRelations(Array.isArray(relData) ? relData : [])
    } finally {
      setLoading(false)
    }
  }, [currentProject?.id])

  useEffect(() => {
    if (projectLoading) return
    if (!currentProject) { setClasses([]); setRelations([]); setLoading(false); return }
    setSelectedId(null)
    fetchClasses()
  }, [currentProject?.id, projectLoading])

  // この画面が表示状態になったら再取得する（マウント維持のため、他画面での変更を反映）
  useEffect(() => {
    if (active && currentProject) fetchClasses()
  }, [active, currentProject?.id, fetchClasses])

  useEffect(() => {
    if (initialSelectedId && classes.length > 0) {
      setSelectedId(initialSelectedId)
    }
  }, [initialSelectedId, classes.length])

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
    if (!selectedId || !currentProject) {
      setProjectAttrs([]); setInheritedAttrs([]); setOwnAttrs([])
      return
    }
    const cls = classes.find((c) => c.id === selectedId)
    // 常時編集可のため、選択のたびに編集フィールドを対象クラスで初期化する
    if (cls) {
      setEditName(cls.name)
      setEditNameEn(cls.nameEn ?? "")
      setEditDesc(cls.description)
      setEditParentId(cls.parentId)
    }
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
          nameEn: newNameEn.trim(),
          description: newDesc.trim(),
          parentId: newParentId,
        }),
      })
      const created: OntologyClass = await res.json()
      await fetchClasses()
      setSelectedId(created.id)
      setShowAdd(false)
      setNewName(""); setNewNameEn(""); setNewDesc(""); setNewParentId(null)
    } finally {
      setAdding(false)
    }
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
          nameEn: editNameEn.trim(),
          description: editDesc.trim(),
          parentId: editParentId,
        }),
      })
      await fetchClasses()
    } finally {
      setSaving(false)
    }
  }

  // 削除ダイアログを開きながらインスタンス数を取得
  const openDeleteDialog = async () => {
    setDeleteChildMode("promote")
    setDeleteInstanceMode("unclassify")
    setDeleteInstanceCount(0)
    setShowDelete(true)
    if (!selected) return
    setLoadingDeleteInfo(true)
    try {
      const res = await fetch(`/api/instances?classId=${selected.id}`)
      const insts = await res.json()
      setDeleteInstanceCount(Array.isArray(insts) ? insts.length : 0)
    } finally {
      setLoadingDeleteInfo(false)
    }
  }

  const handleDelete = async () => {
    if (!selected) return
    setDeleting(true)
    try {
      const children = classes.filter((c) => c.parentId === selected.id)

      // 子クラスの処理
      if (hasChildren) {
        if (deleteChildMode === "cascade") {
          await Promise.all(children.map((child) => fetch(`/api/classes/${child.id}`, { method: "DELETE" })))
        } else {
          await Promise.all(children.map((child) =>
            fetch(`/api/classes/${child.id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ parentId: null }),
            })
          ))
        }
      }

      // インスタンスの処理
      if (deleteInstanceCount > 0) {
        const instRes = await fetch(`/api/instances?classId=${selected.id}`)
        const insts = await instRes.json()
        if (Array.isArray(insts)) {
          if (deleteInstanceMode === "delete") {
            await Promise.all(insts.map((inst) => fetch(`/api/instances/${inst.id}`, { method: "DELETE" })))
          } else {
            await Promise.all(insts.map((inst) =>
              fetch(`/api/instances/${inst.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ classId: null }),
              })
            ))
          }
        }
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
    setAttrName(""); setAttrDesc(""); setAttrDataType("文字列"); setAttrRequired("任意")
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
          description: attrDesc.trim(),
          dataType: attrDataType,
          required: attrRequired,
          scope,
          targetId,
          targetType,
        }),
      })
      await fetchAllAttrs(selected.id, selected.parentId, currentProject.id)
      setShowAddAttr(false)
      setAttrName(""); setAttrDesc(""); setAttrDataType("文字列"); setAttrRequired("任意")
    } finally {
      setAddingAttr(false)
    }
  }

  // 属性編集ダイアログを開く
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

  const handleExport = async () => {
    if (!currentProject || classes.length === 0) return
    setExporting(true)
    try {
      const attrsByClassId = new Map<string, OntologyAttribute[]>()
      await Promise.all(classes.map(async (c) => {
        const attrs = await fetch(`/api/attributes?targetId=${c.id}`).then((r) => r.json())
        attrsByClassId.set(c.id, Array.isArray(attrs) ? attrs : [])
      }))
      const yamlText = buildClassesYaml(classes, attrsByClassId)
      downloadYaml(`classes_${currentProject.name}.yaml`, yamlText)
    } finally {
      setExporting(false)
    }
  }

  const tree = buildTree(classes)

  // ツリーを深さ付きで平坦化（一覧テーブルのインデント表示用）
  const flatClasses: { node: TreeNode; depth: number }[] = []
  const walkTree = (nodes: TreeNode[], depth: number) => {
    for (const n of nodes) {
      flatClasses.push({ node: n, depth })
      if (n.children.length) walkTree(n.children, depth + 1)
    }
  }
  walkTree(tree, 0)

  // 初回訪問（未選択）時は先頭のクラスを自動選択する。再訪問時は前回の選択を維持する
  useEffect(() => {
    if (loading || selectedId || tree.length === 0) return
    setSelectedId(tree[0].id)
  }, [loading, selectedId, tree.length])

  const selected = classes.find((c) => c.id === selectedId)
  const childClasses = selected ? classes.filter((c) => c.parentId === selected.id) : []
  const hasChildren = childClasses.length > 0
  const parentClass = selected?.parentId ? classes.find((c) => c.id === selected.parentId) : null
  const parentName = parentClass?.name ?? "なし"
  const directRelations = selected
    ? relations.filter((r) => r.classPairs.some((p) => p.sourceClassId === selected.id || p.targetClassId === selected.id))
    : []

  // 親クラスを遡って継承リレーションを収集する
  type InheritedRelRow = { relation: OntologyRelation; sourceClassId: string; targetClassId: string; inheritedFrom: OntologyClass }
  const inheritedRelations: InheritedRelRow[] = []
  if (selected) {
    const directIds = new Set(directRelations.map((r) => r.id))
    let ancestorId = selected.parentId
    while (ancestorId) {
      const ancestor = classes.find((c) => c.id === ancestorId)
      if (!ancestor) break
      for (const rel of relations) {
        if (directIds.has(rel.id)) continue
        for (const pair of rel.classPairs) {
          if (pair.sourceClassId === ancestor.id || pair.targetClassId === ancestor.id) {
            inheritedRelations.push({ relation: rel, sourceClassId: pair.sourceClassId, targetClassId: pair.targetClassId, inheritedFrom: ancestor })
            directIds.add(rel.id) // 同じリレーションを重複追加しない
          }
        }
      }
      ancestorId = ancestor.parentId
    }
  }

  const getClassName = (id: string) => classes.find((c) => c.id === id)?.name ?? "不明"

  // 変更があるか（保存ボタンの活性判定）
  const classDirty = !!selected && (
    editName !== selected.name ||
    editNameEn !== (selected.nameEn ?? "") ||
    editDesc !== (selected.description ?? "") ||
    (editParentId ?? null) !== (selected.parentId ?? null)
  )

  // 関連リレーション表のクラスセル（選択中クラスは強調、はみ出しは省略＋ホバーで全表示）
  const renderRelClassCell = (id: string) => {
    const name = getClassName(id)
    const isSelf = !!selected && id === selected.id
    return (
      <span
        title={name}
        className={cn(
          "block truncate",
          isSelf ? "font-semibold text-indigo-700 dark:text-indigo-300" : "text-foreground",
        )}
      >
        {name}
      </span>
    )
  }

  const parentCandidates = classes.filter((c) => c.parentId === null && c.id !== selectedId)
  const addParentCandidates = classes.filter((c) => c.parentId === null)

  // 属性セクションのレンダリング
  const renderAttrSection = (
    title: string,
    attrs: OntologyAttribute[],
    section: AttrSectionKey,
  ) => {
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

  const scopeWarningText = (section: AttrSectionKey): string | null => {
    if (section === "project") return "この属性はプロジェクト全体で共有されます。変更はすべてのクラスに影響します。"
    if (section === "parent") return `この属性は「${parentName}」クラスの属性です。変更はそのクラス全体に影響します。`
    return null
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar title="クラス管理">
        <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-transparent"
          onClick={handleExport} disabled={!currentProject || classes.length === 0 || exporting}>
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
            <h2 className="text-base font-semibold text-foreground">クラス一覧</h2>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-transparent"
              onClick={openAddDialog}>
              <Plus className="h-3.5 w-3.5" />クラスを追加
            </Button>
          </div>
          <div className="flex-1 overflow-auto px-6 pb-6">
            {loading ? (
              <div className="flex h-32 items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : flatClasses.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">
                {currentProject ? "クラスが登録されていません" : "プロジェクトを選択してください"}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="font-semibold text-foreground">クラス名</TableHead>
                      <TableHead className="w-40 font-semibold text-foreground">親クラス</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {flatClasses.map(({ node, depth }) => {
                      const isSel = selectedId === node.id
                      const parent = node.parentId ? classes.find((c) => c.id === node.parentId) : null
                      return (
                        <TableRow
                          key={node.id}
                          className={cn(
                            "cursor-pointer transition-colors",
                            isSel
                              ? "bg-indigo-100 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-950/50"
                              : "hover:bg-muted/50",
                          )}
                          onClick={() => setSelectedId(node.id)}
                        >
                          <TableCell className="font-medium text-foreground">
                            <span className="flex items-start" style={{ paddingLeft: depth * 16 }}>
                              {depth > 0 && <span className="mr-1 text-muted-foreground/70">└</span>}
                              <span className="flex flex-col">
                                <span>{node.name}</span>
                                {node.nameEn && <span className="text-xs font-normal text-muted-foreground">{node.nameEn}</span>}
                              </span>
                            </span>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{parent?.name ?? "—"}</TableCell>
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
                {/* 基本情報 */}
                <section className="space-y-3">
                  <SectionHeader icon={FileText} title="基本情報" />
                  <div className="space-y-3">
                    <div className="space-y-0.5 text-xs text-muted-foreground">
                      <p>登録日 {formatDateTime(selected.createdAt)}{selected.createdBy ? `（${selected.createdBy}）` : ""}</p>
                      <p>更新日 {formatDateTime(selected.updatedAt)}{selected.updatedBy ? `（${selected.updatedBy}）` : ""}</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">クラス名（日本語名） <span className="text-destructive">*</span></Label>
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)}
                        placeholder="例：不具合事例" className="h-8" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">クラス名（英語名）</Label>
                      <Input value={editNameEn} onChange={(e) => setEditNameEn(e.target.value)}
                        placeholder="例：Defect Case" className="h-8" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">説明</Label>
                      <Textarea rows={4} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">親クラス</Label>
                      <Select
                        value={editParentId ?? "__none__"}
                        onValueChange={(v) => setEditParentId(v === "__none__" ? null : v)}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue>
                            {editParentId
                              ? (parentCandidates.find(c => c.id === editParentId)?.name ?? editParentId)
                              : "なし"}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent className="max-h-72">
                          <SelectItem value="__none__">なし</SelectItem>
                          {parentCandidates.map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
                      {selected.parentId && renderAttrSection(
                        `継承属性（${parentName}）`,
                        inheritedAttrs,
                        "parent"
                      )}
                      {renderAttrSection("クラス固有属性", ownAttrs, "own")}
                    </div>
                  )}
                </section>

                {/* 関連リレーション */}
                <section className="space-y-4">
                  <SectionHeader icon={Link2} title="関連リレーション" />
                  <div className="space-y-6">
                    {/* クラスが利用されているリレーション */}
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">クラスが利用されているリレーション</p>
                      <div className="rounded-lg border border-border">
                        <Table className="table-fixed">
                          <TableHeader>
                            <TableRow className="bg-muted/50 hover:bg-muted/50">
                              <TableHead className="w-[30%] font-semibold text-foreground">始点クラス</TableHead>
                              <TableHead className="w-[40%] font-semibold text-foreground">リレーション名</TableHead>
                              <TableHead className="w-[30%] font-semibold text-foreground">終点クラス</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {directRelations.length > 0 ? (
                              directRelations.flatMap((r) =>
                                r.classPairs
                                  .filter((p) => p.sourceClassId === selected!.id || p.targetClassId === selected!.id)
                                  .map((p, i) => (
                                    <TableRow key={`${r.id}-${i}`}>
                                      <TableCell>{renderRelClassCell(p.sourceClassId)}</TableCell>
                                      <TableCell className="font-medium text-foreground">
                                        <span title={r.name} className="block truncate">{r.name}</span>
                                      </TableCell>
                                      <TableCell>{renderRelClassCell(p.targetClassId)}</TableCell>
                                    </TableRow>
                                  ))
                              )
                            ) : (
                              <TableRow>
                                <TableCell colSpan={3} className="text-center text-muted-foreground">
                                  このクラスが使われているリレーションはありません
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </div>

                    {/* 継承されたリレーション */}
                    {inheritedRelations.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">継承されたリレーション</p>
                        <div className="rounded-lg border border-border">
                          <Table className="table-fixed">
                            <TableHeader>
                              <TableRow className="bg-muted/50 hover:bg-muted/50">
                                <TableHead className="w-[25%] font-semibold text-foreground">始点クラス</TableHead>
                                <TableHead className="w-[30%] font-semibold text-foreground">リレーション名</TableHead>
                                <TableHead className="w-[25%] font-semibold text-foreground">終点クラス</TableHead>
                                <TableHead className="w-[20%] font-semibold text-foreground">継承元クラス</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {inheritedRelations.map((row, i) => (
                                <TableRow key={`inh-${row.relation.id}-${i}`}>
                                  <TableCell>{renderRelClassCell(row.sourceClassId)}</TableCell>
                                  <TableCell className="font-medium text-foreground">
                                    <span title={row.relation.name} className="block truncate">{row.relation.name}</span>
                                  </TableCell>
                                  <TableCell>{renderRelClassCell(row.targetClassId)}</TableCell>
                                  <TableCell>
                                    <span title={row.inheritedFrom.name} className="block truncate text-sm text-muted-foreground">{row.inheritedFrom.name}</span>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    )}

                    {directRelations.length === 0 && inheritedRelations.length === 0 && (
                      <p className="text-center text-sm text-muted-foreground py-4">関連するリレーションはありません</p>
                    )}
                  </div>
                </section>
              </div>

              {/* フッター：削除・保存 */}
              <div className="flex items-center justify-between border-t border-border px-4 py-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={openDeleteDialog}
                >
                  <Trash2 className="h-3.5 w-3.5" />削除
                </Button>
                <Button size="sm" variant="success" onClick={handleSave} disabled={!editName.trim() || saving || !classDirty}>
                  {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}保存
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
              クラスを選択してください
            </div>
          )}
        </div>
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
              <Label htmlFor="cls-name-en">英語名</Label>
              <Input id="cls-name-en" value={newNameEn} onChange={(e) => setNewNameEn(e.target.value)}
                placeholder="例：Defect Case" />
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
              <Label htmlFor="attr-desc">説明</Label>
              <Textarea id="attr-desc" rows={2} value={attrDesc}
                onChange={(e) => setAttrDesc(e.target.value)}
                placeholder="属性の意味・用途を記述" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="attr-dtype">データ型</Label>
              <Select value={attrDataType} onValueChange={(v) => { if (v) setAttrDataType(v) }}>
                <SelectTrigger id="attr-dtype">
                  <SelectValue>{attrDataType}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {["文字列", "数値", "日付", "真偽値"].map((t) => (
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
              <Label htmlFor="edit-attr-desc">説明</Label>
              <Textarea id="edit-attr-desc" rows={2} value={editAttrDesc}
                onChange={(e) => setEditAttrDesc(e.target.value)}
                placeholder="属性の意味・用途を記述" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-attr-dtype">データ型</Label>
              <Select value={editAttrDataType} onValueChange={(v) => { if (v) setEditAttrDataType(v) }}>
                <SelectTrigger id="edit-attr-dtype">
                  <SelectValue>{editAttrDataType}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {["文字列", "数値", "日付", "真偽値"].map((t) => (
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>「{selected?.name}」を削除</DialogTitle>
          </DialogHeader>

          {loadingDeleteInfo ? (
            <div className="flex items-center justify-center py-4 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />確認中…
            </div>
          ) : (
            <div className="space-y-5 py-1">
              {/* 子クラスの処理 */}
              {hasChildren && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">
                    子クラスの扱い
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      （{childClasses.length}件）
                    </span>
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {(["promote", "cascade"] as const).map((mode) => (
                      <label key={mode} className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
                        <input
                          type="radio"
                          name="childMode"
                          value={mode}
                          checked={deleteChildMode === mode}
                          onChange={() => setDeleteChildMode(mode)}
                          className="accent-foreground"
                        />
                        {mode === "promote" ? "親なしで残す" : "一緒に削除"}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* インスタンスの処理 */}
              {deleteInstanceCount > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">
                    インスタンスの扱い
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      （{deleteInstanceCount}件）
                    </span>
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {(["unclassify", "delete"] as const).map((mode) => (
                      <label key={mode} className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
                        <input
                          type="radio"
                          name="instanceMode"
                          value={mode}
                          checked={deleteInstanceMode === mode}
                          onChange={() => setDeleteInstanceMode(mode)}
                          className="accent-foreground"
                        />
                        {mode === "unclassify" ? "未分類として残す" : "一緒に削除"}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {!hasChildren && deleteInstanceCount === 0 && (
                <p className="text-sm text-muted-foreground">
                  この操作は取り消せません。
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)} disabled={deleting}>
              キャンセル
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting || loadingDeleteInfo}>
              {deleting ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" />処理中…</> : "削除する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* クラス定義インポート */}
      <ImportDialog<ClassExportItem>
        open={showImport}
        onOpenChange={setShowImport}
        title="クラス定義をインポート"
        entityLabel="クラス"
        replaceNote="紐づくインスタンスは削除せず未分類になります。"
        parse={parseClassesYaml}
        preview={(items, mode) => previewClassesImport(items, classes, mode)}
        onExecute={async (items, mode) => {
          if (!currentProject) throw new Error("プロジェクトが選択されていません")
          const result = await executeClassesImport(currentProject.id, items, classes, mode)
          return {
            created: result.created,
            updated: result.updated,
            deleted: result.deleted,
            note: result.unclassifiedInstances > 0
              ? `未分類にしたインスタンス: ${result.unclassifiedInstances}件`
              : undefined,
          }
        }}
        onImported={async () => {
          setSelectedId(null)
          await fetchClasses()
        }}
      />
    </div>
  )
}
