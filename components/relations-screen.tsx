"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
import { relations, relationAttributes, parentClassOptions } from "@/lib/ontology-data"
import { Plus, Pencil, Trash2, ArrowRight } from "lucide-react"

export function RelationsScreen() {
  const [selectedId, setSelectedId] = useState("r1")
  const selected = relations.find((r) => r.id === selectedId)!

  return (
    <div className="flex h-full flex-col">
      <TopBar title="リレーション管理" />
      <div className="grid flex-1 grid-cols-3 overflow-hidden">
        {/* 左ペイン */}
        <div className="col-span-1 flex flex-col border-r border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">リレーション一覧</h2>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-transparent">
              <Plus className="h-3.5 w-3.5" />
              リレーションを追加
            </Button>
          </div>
          <div className="flex-1 overflow-auto p-2">
            {relations.map((r) => {
              const isSelected = selectedId === r.id
              return (
                <button
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  className={cn(
                    "flex w-full flex-wrap items-center gap-1.5 rounded-md px-3 py-2.5 text-left text-sm transition-colors",
                    isSelected ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                  )}
                >
                  <span className="text-foreground">{r.sourceClass}</span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  <span className="font-medium text-foreground">{r.name}</span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  <span className="text-foreground">{r.targetClass}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* 右ペイン */}
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
              </TabsList>

              <TabsContent value="basic" className="mt-6 max-w-xl space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="rel-name">リレーション名</Label>
                  <Input id="rel-name" defaultValue={selected.name} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="rel-source">始点クラス</Label>
                    <Select defaultValue={selected.sourceClass}>
                      <SelectTrigger id="rel-source">
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
                  <div className="space-y-2">
                    <Label htmlFor="rel-target">終点クラス</Label>
                    <Select defaultValue={selected.targetClass}>
                      <SelectTrigger id="rel-target">
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
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rel-desc">説明</Label>
                  <Textarea id="rel-desc" rows={4} defaultValue={selected.description} />
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
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {relationAttributes.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell className="font-medium text-foreground">{a.name}</TableCell>
                          <TableCell className="text-muted-foreground">{a.dataType}</TableCell>
                          <TableCell>
                            <Badge variant={a.required === "必須" ? "default" : "secondary"} className="font-normal">
                              {a.required}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </div>
  )
}
