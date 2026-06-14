"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { TopBar } from "@/components/top-bar"
import { cn } from "@/lib/utils"
import { instanceClassList, instancesByClass } from "@/lib/ontology-data"
import { Plus, Pencil, Trash2 } from "lucide-react"

export function InstancesScreen() {
  const [selectedClass, setSelectedClass] = useState(instanceClassList[0])
  const instances = instancesByClass[selectedClass] ?? []

  return (
    <div className="flex h-full flex-col">
      <TopBar title="登録済みインスタンス" />
      <div className="flex flex-1 gap-6 overflow-hidden p-6">
        {/* 左ペイン：クラス選択 */}
        <div className="w-1/3 min-w-64">
          <Card className="flex h-full flex-col">
            <CardHeader>
              <CardTitle className="text-base">クラス選択</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-auto">
              <ul className="space-y-1">
                {instanceClassList.map((cls) => {
                  const isActive = cls === selectedClass
                  const count = instancesByClass[cls]?.length ?? 0
                  return (
                    <li key={cls}>
                      <button
                        onClick={() => setSelectedClass(cls)}
                        className={cn(
                          "flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors",
                          isActive
                            ? "bg-foreground font-medium text-background"
                            : "text-foreground hover:bg-muted",
                        )}
                      >
                        <span>{cls}</span>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-xs tabular-nums",
                            isActive ? "bg-background/20 text-background" : "bg-muted text-muted-foreground",
                          )}
                        >
                          {count}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </CardContent>
          </Card>
        </div>

        {/* 右ペイン：インスタンス一覧 */}
        <div className="flex-1 overflow-hidden">
          <Card className="flex h-full flex-col">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">{selectedClass}</CardTitle>
              <Button size="sm">
                <Plus className="mr-1.5 h-4 w-4" />
                インスタンスを追加
              </Button>
            </CardHeader>
            <CardContent className="flex-1 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>インスタンス名</TableHead>
                    <TableHead className="w-32">登録日</TableHead>
                    <TableHead className="w-32">登録者</TableHead>
                    <TableHead className="w-28 text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {instances.map((inst) => (
                    <TableRow key={inst.id}>
                      <TableCell className="font-medium text-foreground">{inst.name}</TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">{inst.registeredAt}</TableCell>
                      <TableCell className="text-muted-foreground">{inst.registeredBy}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="編集">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            aria-label="削除"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
