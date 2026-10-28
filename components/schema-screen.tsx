"use client"

// スキーマビュー（オントロジー設計）。クラスとリレーションの定義を設計図風の模式図で表示する。
//   データは classes / relations を取得して渡す（ノード/エッジへの変換と描画は schema-graph）。

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import { TopBar } from "@/components/top-bar"
import { SchemaGraph } from "@/components/schema-graph"
import { useProject } from "@/app/project-context"
import type { OntologyClass, OntologyRelation } from "@/lib/types"

export function SchemaScreen({ active }: { active?: boolean }) {
  const { currentProject, loading: projectLoading } = useProject()
  const [classes, setClasses] = useState<OntologyClass[]>([])
  const [relations, setRelations] = useState<OntologyRelation[]>([])
  const [loading, setLoading] = useState(true)

  const fetchAll = useCallback(async () => {
    if (!currentProject) return
    setLoading(true)
    try {
      const [c, r] = await Promise.all([
        fetch(`/api/classes?projectId=${currentProject.id}`).then((res) => res.json()),
        fetch(`/api/relations?projectId=${currentProject.id}`).then((res) => res.json()),
      ])
      setClasses(Array.isArray(c) ? c : [])
      setRelations(Array.isArray(r) ? r : [])
    } finally {
      setLoading(false)
    }
  }, [currentProject?.id])

  // プロジェクト切替時のみデータを捨てる。取得は下の表示時 effect に任せる。
  useEffect(() => {
    if (projectLoading) return
    setClasses([]); setRelations([])
    setLoading(!!currentProject)
  }, [currentProject?.id, projectLoading])

  useEffect(() => {
    if (active && currentProject) fetchAll()
  }, [active, currentProject?.id, fetchAll])

  // 始点/終点が未設定・削除済みのペアを持つリレーション（図には描かない）
  const incompleteCount = useMemo(() => {
    const ids = new Set(classes.map((c) => c.id))
    return relations.filter(
      (r) =>
        r.classPairs.length === 0 ||
        r.classPairs.some((p) => !ids.has(p.sourceClassId) || !ids.has(p.targetClassId)),
    ).length
  }, [classes, relations])

  return (
    <div className="flex h-full flex-col">
      <TopBar group="オントロジー設計" title="スキーマビュー">
        {!loading && currentProject && classes.length > 0 && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {incompleteCount > 0 && (
              <span className="flex items-center gap-1 text-amber-600">
                <AlertTriangle className="h-3.5 w-3.5" />
                不完全なリレーション {incompleteCount}件（図には表示されません）
              </span>
            )}
            <span>クラス {classes.length}・リレーション {relations.length}</span>
          </div>
        )}
      </TopBar>
      <div className="flex-1 overflow-hidden">
        {loading && classes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 bg-[#0a1a2f]">
            <Loader2 className="h-16 w-16 animate-spin text-sky-200" />
            <p className="text-sm text-sky-100/80">読込中...</p>
          </div>
        ) : !currentProject ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            プロジェクトを選択してください
          </div>
        ) : (
          <SchemaGraph classes={classes} relations={relations} layoutKey={`schema-layout:${currentProject.id}`} />
        )}
      </div>
    </div>
  )
}
