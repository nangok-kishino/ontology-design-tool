"use client"

// グラフビュー（ナレッジグラフ作成）。本登録トリプレットをサイバー風の力学グラフで表示する。
//   データは triplets / instances / classes を取得して {nodes, links} に変換（描画は triplet-graph）。

import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import { TopBar } from "@/components/top-bar"
import { TripletGraph } from "@/components/triplet-graph"
import { useProject } from "@/app/project-context"
import type { Triplet, OntologyInstance, OntologyClass, OntologyAttribute } from "@/lib/types"

export function GraphScreen({ active }: { active?: boolean }) {
  const { currentProject, loading: projectLoading } = useProject()
  const [triplets, setTriplets] = useState<Triplet[]>([])
  const [instances, setInstances] = useState<OntologyInstance[]>([])
  const [classes, setClasses] = useState<OntologyClass[]>([])
  // トリプレット（エッジ）の属性値はキーが属性id。ツールチップに属性名で表示するための id→名前 対応。
  const [attrNameById, setAttrNameById] = useState<Map<string, string>>(new Map())
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
      const tlist: Triplet[] = Array.isArray(t) ? t : []
      setTriplets(tlist)
      setInstances(Array.isArray(i) ? i : [])
      setClasses(Array.isArray(c) ? c : [])

      // エッジ属性名の解決用に、プロジェクト共通属性＋トリプレットで使われている述語リレーションの
      // 属性定義を取得して id→名前 マップを作る。
      const relIds = Array.from(new Set(tlist.map((x) => x.predicateRelationId).filter(Boolean)))
      const attrLists: unknown[] = await Promise.all([
        fetch(`/api/attributes?targetId=${currentProject.id}`).then((res) => res.json()),
        ...relIds.map((rid) => fetch(`/api/attributes?targetId=${rid}`).then((res) => res.json())),
      ])
      const m = new Map<string, string>()
      for (const list of attrLists) {
        if (Array.isArray(list)) for (const a of list as OntologyAttribute[]) m.set(a.id, a.name)
      }
      setAttrNameById(m)
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
          <TripletGraph triplets={triplets} instById={instById} classNameById={classNameById} attrNameById={attrNameById} />
        )}
      </div>
    </div>
  )
}
