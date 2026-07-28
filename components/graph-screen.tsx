"use client"

// グラフビュー（ナレッジグラフ作成）。本登録トリプレットをサイバー風の力学グラフで表示する。
//   データは triplets / instances / classes を取得して {nodes, links} に変換（描画は triplet-graph）。

import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import { TopBar } from "@/components/top-bar"
import { TripletGraph } from "@/components/triplet-graph"
import { useProject } from "@/app/project-context"
import type { Triplet, OntologyInstance, OntologyClass } from "@/lib/types"

export function GraphScreen({ active }: { active?: boolean }) {
  const { currentProject, loading: projectLoading } = useProject()
  const [triplets, setTriplets] = useState<Triplet[]>([])
  const [instances, setInstances] = useState<OntologyInstance[]>([])
  const [classes, setClasses] = useState<OntologyClass[]>([])
  const [loading, setLoading] = useState(true)

  const classNameById = useMemo(() => new Map(classes.map((c) => [c.id, c.name])), [classes])
  const instById = useMemo(() => new Map(instances.map((i) => [i.id, i])), [instances])

  const fetchAll = useCallback(async () => {
    if (!currentProject) return
    setLoading(true)
    try {
      const [t, i, c] = await Promise.all([
        fetch(`/api/triplets?projectId=${currentProject.id}`).then((res) => res.json()),
        fetch(`/api/instances?projectId=${currentProject.id}`).then((res) => res.json()),
        fetch(`/api/classes?projectId=${currentProject.id}`).then((res) => res.json()),
      ])
      setTriplets(Array.isArray(t) ? t : [])
      setInstances(Array.isArray(i) ? i : [])
      setClasses(Array.isArray(c) ? c : [])
    } finally {
      setLoading(false)
    }
  }, [currentProject?.id])

  useEffect(() => {
    if (projectLoading) return
    if (!currentProject) {
      setTriplets([]); setInstances([]); setClasses([]); setLoading(false)
      return
    }
    fetchAll()
  }, [currentProject?.id, projectLoading])

  useEffect(() => {
    if (active && currentProject) fetchAll()
  }, [active, currentProject?.id, fetchAll])

  const nodeCount = useMemo(() => {
    const ids = new Set<string>()
    triplets.forEach((t) => { ids.add(t.subjectInstanceId); ids.add(t.objectInstanceId) })
    return ids.size
  }, [triplets])

  return (
    <div className="flex h-full flex-col">
      <TopBar title="グラフビュー">
        {!loading && currentProject && triplets.length > 0 && (
          <span className="text-xs text-muted-foreground">
            ノード {nodeCount}・エッジ {triplets.length}
          </span>
        )}
      </TopBar>
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="flex h-full items-center justify-center bg-[#0a0b14]">
            <Loader2 className="h-6 w-6 animate-spin text-indigo-300" />
          </div>
        ) : !currentProject ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            プロジェクトを選択してください
          </div>
        ) : (
          <TripletGraph triplets={triplets} instById={instById} classNameById={classNameById} />
        )}
      </div>
    </div>
  )
}
