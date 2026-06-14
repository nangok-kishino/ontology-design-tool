"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
import { ChevronDown, ChevronRight, Plus, Pencil, Trash2, Loader2 } from "lucide-react"

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
            onClick={(e) => {
              e.stopPropagation()
              setOpen(!open)
            }}
            className="flex h-4 w-4 items-center justify-center text-muted-foreground"
            aria-label={open ? "折りたたむ" : "展開する"}
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
            <TreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function ClassesScreen() {
  const [classes, setClasses] = useState<OntologyClass[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/classes")
      .then((r) => r.json())
      .then((data: OntologyClass[]) => {
        setClasses(data)
        if (data.length > 0) {
          setSelectedId(data[0].id)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  const tree = buildTree(classes)
  const selected = classes.find((c) => c.id === selectedId)
  const parentName = selected?.parentId
    ? (classes.find((c) => c.id === selected.parentId)?.name ?? "（なし）")
    : "（なし）"

  // 静的リレーション（Step6-7で置き換え）
  const relatedRelations = selected
    ? relations.filter((r) => r.sourceClass === selected.name || r.targetClass === selected.name)
    : []

  return (
    <div className="flex h-full flex-col">
      <TopBar title="クラス管理" />
      <div className="grid flex-1 grid-cols-3 overflow-hidden">
        {/* 左ペイン */}
        <div className="col-span-1 flex flex-col border-r border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">クラス一覧</h2>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-transparent">
              <Plus className="h-3.5 w-3.5" />
              クラスを追加
            </Button>
          </div>
          <div className="flex-1 overflow-auto p-2">
            {loading ? (
              <div className="flex h-32 items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : tree.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">
                クラスが登録されていません
              </p>
            ) : (
              tree.map((node) => (
                <TreeItem
                  key={node.id}
                  node={node}
                  depth={0}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              ))
            )}
          </div>
        </div>

        {/* 右ペイン */}
        {selected ? (
          <div className="col-span-2 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-6 py-3">
              <h2 className="text-base font-semibold text-foreground">{selected.name}</h2>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-transparent">
                  <Pencil className="h-3.5 w-3.5" />
                  編集
                </Button>
                <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-transparent text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                  削除
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-6">
              <Tabs defaultValue="basic">
                <TabsList>
                  <TabsTrigger value="basic">基本情報</TabsTrigger>
                  <TabsTrigger value="attributes">属性</TabsTrigger>
                  <TabsTrigger value="relations">関連リレーション</TabsTrigger>
                </TabsList>

                <TabsContent value="basic" className="mt-6 max-w-xl space-y-5">
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
                </TabsContent>

                <TabsContent value="attributes" className="mt-6">
                  <div className="mb-3 flex justify-end">
                    <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-transparent">
                      <Plus className="h-3.5 w-3.5" />
                      属性を追加
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
                              <Badge
                                variant={a.required === "必須" ? "default" : "secondary"}
                                className="font-normal"
                              >
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
    </div>
  )
}
