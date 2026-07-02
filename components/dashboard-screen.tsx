"use client"

import { useState, useEffect, useCallback } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TopBar } from "@/components/top-bar"
import { Loader2, Download } from "lucide-react"
import { useProject } from "@/app/project-context"
import type { ScreenId } from "@/components/sidebar"
import type { OntologyClass, OntologyInstance, OntologyRelation } from "@/lib/types"

type TreeNode = OntologyClass & { children: TreeNode[] }

function buildTree(items: OntologyClass[]): TreeNode[] {
  const map = new Map<string, TreeNode>(
    items.map((c) => [c.id, { ...c, children: [] }]),
  )
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

type ClassRow = {
  key: string
  parentNodeId: string | null
  parentLabel: string
  parentNameEn: string
  classLabel: string | null
  classNameEn: string | null
  insts: OntologyInstance[]
}

function flattenClassRows(
  nodes: TreeNode[],
  instances: OntologyInstance[],
  parent: { id: string; name: string; nameEn: string } | null = null,
): ClassRow[] {
  const rows: ClassRow[] = []
  for (const node of nodes) {
    const isRoot = parent === null
    rows.push({
      key: node.id,
      parentNodeId: parent?.id ?? null,
      parentLabel: isRoot ? node.name : parent.name,
      parentNameEn: isRoot ? (node.nameEn ?? "") : parent.nameEn,
      classLabel: isRoot ? null : node.name,
      classNameEn: isRoot ? null : (node.nameEn ?? ""),
      insts: instances.filter((i) => i.classId === node.id),
    })
    if (node.children.length > 0) {
      rows.push(...flattenClassRows(node.children, instances, { id: node.id, name: node.name, nameEn: node.nameEn ?? "" }))
    }
  }
  return rows
}

interface Props {
  onNavigate: (screen: ScreenId, id?: string) => void
}

// OWL/RDF エクスポートは未実装のため非表示。実装後に true にする
const OWL_RDF_EXPORT_ENABLED = false

function CountBadge({ count }: { count: number }) {
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
      {count}
    </span>
  )
}

export function DashboardScreen({ onNavigate }: Props) {
  const { currentProject, loading: projectLoading } = useProject()
  const [classes, setClasses] = useState<OntologyClass[]>([])
  const [instances, setInstances] = useState<OntologyInstance[]>([])
  const [relations, setRelations] = useState<OntologyRelation[]>([])
  const [loading, setLoading] = useState(true)

  const fetchAll = useCallback(async () => {
    if (!currentProject) return
    setLoading(true)
    try {
      const [cls, inst, rel] = await Promise.all([
        fetch(`/api/classes?projectId=${currentProject.id}`).then((r) => r.json()),
        fetch(`/api/instances?projectId=${currentProject.id}`).then((r) => r.json()),
        fetch(`/api/relations?projectId=${currentProject.id}`).then((r) => r.json()),
      ])
      setClasses(Array.isArray(cls) ? cls : [])
      setInstances(Array.isArray(inst) ? inst : [])
      setRelations(Array.isArray(rel) ? rel : [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [currentProject?.id])

  useEffect(() => {
    if (projectLoading) return
    if (!currentProject) {
      setClasses([]); setInstances([]); setRelations([]); setLoading(false)
      return
    }
    fetchAll()
  }, [currentProject?.id, projectLoading])

  const classRows = flattenClassRows(buildTree(classes), instances)

  const knownClassIds = new Set(classes.map((c) => c.id))
  const unclassifiedInstances = instances.filter(
    (i) => !i.classId || !knownClassIds.has(i.classId),
  )

  const classMap = new Map(classes.map((c) => [c.id, c]))
  const relationRows = relations

  return (
    <div className="flex h-full flex-col">
      <TopBar title="ダッシュボード" />

      {projectLoading || loading ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : !currentProject ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          プロジェクトを選択してください
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-6">
          {OWL_RDF_EXPORT_ENABLED && (
            <div className="mb-6 flex justify-end">
              <Button size="sm" variant="outline" className="gap-2" disabled>
                <Download className="h-4 w-4" />
                OWL/RDF エクスポート
              </Button>
            </div>
          )}

          <div className="grid grid-cols-1 gap-8">
            {/* クラス／インスタンス */}
            <div className="space-y-3">
              <h2 className="flex items-center gap-3 text-base font-semibold text-foreground">
                <span>クラス</span>
                <CountBadge count={classes.length} />
                <span className="text-muted-foreground">/</span>
                <span>インスタンス</span>
                <CountBadge count={instances.length} />
              </h2>
              <div>
                {classRows.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    クラスが登録されていません
                  </p>
                ) : (
                  <div className="rounded-lg border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50 hover:bg-muted/50">
                          <TableHead className="w-36 font-semibold text-foreground">親クラス</TableHead>
                          <TableHead className="w-40 font-semibold text-foreground">クラス</TableHead>
                          <TableHead className="font-semibold text-foreground">インスタンス</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {classRows.map(({ key, parentNodeId, parentLabel, parentNameEn, classLabel, classNameEn, insts }) => (
                          <TableRow key={key}>
                            <TableCell className="align-top">
                              <span
                                className="cursor-pointer font-medium text-foreground hover:underline"
                                onClick={() => onNavigate("classes", parentNodeId ?? key)}
                              >
                                <span className="flex flex-col">
                                  <span>{parentLabel}</span>
                                  {parentNameEn && <span className="text-xs font-normal text-muted-foreground">{parentNameEn}</span>}
                                </span>
                              </span>
                            </TableCell>
                            <TableCell className="align-top">
                              {classLabel ? (
                                <span
                                  className="cursor-pointer font-medium text-foreground hover:underline"
                                  onClick={() => onNavigate("classes", key)}
                                >
                                  <span className="flex flex-col">
                                    <span>{classLabel}</span>
                                    {classNameEn && <span className="text-xs font-normal text-muted-foreground">{classNameEn}</span>}
                                  </span>
                                </span>
                              ) : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell>
                              {insts.length > 0 ? (
                                <div className="flex flex-wrap gap-1.5">
                                  {insts.map((inst) => (
                                    <Badge
                                      key={inst.id}
                                      variant="secondary"
                                      className="cursor-pointer font-normal hover:bg-secondary/60"
                                      onClick={() => onNavigate("instances", inst.classId ?? undefined)}
                                    >
                                      {inst.name}
                                    </Badge>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-sm text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                        {unclassifiedInstances.length > 0 && (
                          <TableRow>
                            <TableCell className="align-top text-muted-foreground">—</TableCell>
                            <TableCell className="align-top text-muted-foreground italic">未分類</TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1.5">
                                {unclassifiedInstances.map((inst) => (
                                  <Badge
                                    key={inst.id}
                                    variant="outline"
                                    className="cursor-pointer font-normal hover:bg-muted"
                                    onClick={() => onNavigate("instances")}
                                  >
                                    {inst.name}
                                  </Badge>
                                ))}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </div>

            {/* リレーション */}
            <div className="space-y-3">
              <h2 className="flex items-center gap-3 text-base font-semibold text-foreground">
                <span>リレーション</span>
                <CountBadge count={relations.length} />
              </h2>
              <div>
                {relationRows.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    リレーションが登録されていません
                  </p>
                ) : (
                  <div className="rounded-lg border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50 hover:bg-muted/50">
                          <TableHead className="w-48 font-semibold text-foreground">リレーション名</TableHead>
                          <TableHead className="w-40 font-semibold text-foreground">始点クラス</TableHead>
                          <TableHead className="font-semibold text-foreground">終点クラス</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {relationRows.map((rel) => (
                          <TableRow
                            key={rel.id}
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => onNavigate("relations", rel.id)}
                          >
                            <TableCell className="align-top font-medium text-foreground">
                              <span className="flex flex-col">
                                <span>{rel.name}</span>
                                {rel.nameEn && <span className="text-xs font-normal text-muted-foreground">{rel.nameEn}</span>}
                              </span>
                            </TableCell>
                            <TableCell className="align-top font-medium text-foreground">
                              <span className="flex flex-col gap-1">
                                {(rel.classPairs ?? []).map((p, i) => {
                                  const src = classMap.get(p.sourceClassId)
                                  return (
                                    <span key={i} className="flex flex-col cursor-pointer hover:underline"
                                      onClick={(e) => { e.stopPropagation(); onNavigate("classes", p.sourceClassId) }}>
                                      <span>{src?.name ?? "—"}</span>
                                      {src?.nameEn && <span className="text-xs font-normal text-muted-foreground">{src.nameEn}</span>}
                                    </span>
                                  )
                                })}
                              </span>
                            </TableCell>
                            <TableCell className="align-top font-medium text-foreground">
                              <span className="flex flex-col gap-1">
                                {(rel.classPairs ?? []).map((p, i) => {
                                  const tgt = classMap.get(p.targetClassId)
                                  return (
                                    <span key={i} className="flex flex-col cursor-pointer hover:underline"
                                      onClick={(e) => { e.stopPropagation(); onNavigate("classes", p.targetClassId) }}>
                                      <span>{tgt?.name ?? "—"}</span>
                                      {tgt?.nameEn && <span className="text-xs font-normal text-muted-foreground">{tgt.nameEn}</span>}
                                    </span>
                                  )
                                })}
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
