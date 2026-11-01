"use client"

// グラフビュー（ナレッジグラフ作成）。本登録トリプレットをグラフで表示する。
//   インスタンス同士のトリプレットだけでなく、端にクラスを含むトリプレットも出す。
//   どちらも lib/graph-edges.ts で1つの形に均してから描画（triplet-graph）へ渡す。

import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import { TopBar } from "@/components/top-bar"
import { TripletGraph } from "@/components/triplet-graph"
import { useProject } from "@/app/project-context"
import { buildHueMap } from "@/lib/graph-colors"
import { rootOf, sortByOrder } from "@/lib/organize"
import { buildGraphEdges } from "@/lib/graph-edges"
import type { Triplet, ClassTriplet, OntologyInstance, OntologyClass, OntologyAttribute, OntologyRelation, RelationConditionSlot } from "@/lib/types"

export function GraphScreen({ active }: { active?: boolean }) {
  const { currentProject, loading: projectLoading } = useProject()
  const [triplets, setTriplets] = useState<Triplet[]>([])
  // 端にクラスを含むトリプレット（別コンテナ）。同じ図に重ねて出す。
  const [classTriplets, setClassTriplets] = useState<ClassTriplet[]>([])
  const [instances, setInstances] = useState<OntologyInstance[]>([])
  const [classes, setClasses] = useState<OntologyClass[]>([])
  // トリプレット（エッジ）の属性値はキーが属性id。ツールチップに属性名で表示するための id→名前 対応。
  const [attrNameById, setAttrNameById] = useState<Map<string, string>>(new Map())
  // リレーションid→成立条件の項目（エッジの条件を日本語に直すのに使う）
  const [conditionSlotsByRelationId, setConditionSlotsByRelationId] = useState<Map<string, RelationConditionSlot[]>>(new Map())
  const [relations, setRelations] = useState<OntologyRelation[]>([])
  const [loading, setLoading] = useState(true)

  const classNameById = useMemo(() => new Map(classes.map((c) => [c.id, c.name])), [classes])
  // 絞り込みパネルの並びはリレーション管理の並び順に合わせる
  const relationOrder = useMemo(
    () => sortByOrder(relations).map((r) => ({ id: r.id, name: r.name })),
    [relations],
  )
  // 色はクラス／リレーションの一覧の並び順で配る。同じクラスのインスタンスは
  // 同じ色、同じリレーションのエッジは同じ色になる（スキーマビューとも揃う）。
  const hueByClassId = useMemo(() => buildHueMap(sortByOrder(classes).map((c) => c.id)), [classes])
  const hueByRelationId = useMemo(() => buildHueMap(sortByOrder(relations).map((r) => r.id), 6), [relations])
  // 列はクラスの括り（ルートクラス）で決める。支柱・ビーム・板のように
  // 同じ親の下にあるクラスは同じ列に入る。
  const rootClassIdById = useMemo(() => {
    const byId = new Map(classes.map((c) => [c.id, c]))
    return new Map(classes.map((c) => [c.id, rootOf(c, byId).id]))
  }, [classes])
  const instById = useMemo(() => new Map(instances.map((i) => [i.id, i])), [instances])

  const fetchAll = useCallback(async () => {
    if (!currentProject) return
    setLoading(true)
    try {
      const [t, ct, i, c, rels] = await Promise.all([
        fetch(`/api/triplets?projectId=${currentProject.id}`).then((res) => res.json()),
        fetch(`/api/class-triplets?projectId=${currentProject.id}`).then((res) => res.json()),
        fetch(`/api/instances?projectId=${currentProject.id}`).then((res) => res.json()),
        fetch(`/api/classes?projectId=${currentProject.id}`).then((res) => res.json()),
        fetch(`/api/relations?projectId=${currentProject.id}`).then((res) => res.json()),
      ])
      const tlist: Triplet[] = Array.isArray(t) ? t : []
      setTriplets(tlist)
      setClassTriplets(Array.isArray(ct) ? ct : [])
      setInstances(Array.isArray(i) ? i : [])
      setClasses(Array.isArray(c) ? c : [])
      setRelations(Array.isArray(rels) ? (rels as OntologyRelation[]) : [])

      const condMap = new Map<string, RelationConditionSlot[]>()
      if (Array.isArray(rels)) {
        for (const r of rels as OntologyRelation[]) {
          if (r.conditions && r.conditions.length > 0) condMap.set(r.id, r.conditions)
        }
      }
      setConditionSlotsByRelationId(condMap)

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

  // プロジェクト切替時のみデータを捨てる。取得は下の表示時 effect に任せる。
  useEffect(() => {
    if (projectLoading) return
    setTriplets([]); setClassTriplets([]); setInstances([]); setClasses([]); setRelations([])
    setLoading(!!currentProject)
  }, [currentProject?.id, projectLoading])

  useEffect(() => {
    if (active && currentProject) fetchAll()
  }, [active, currentProject?.id, fetchAll])

  // 画面に今出ている数（絞り込みパネルの結果）。上部の表示に使う。
  const [visibleCounts, setVisibleCounts] = useState({ nodes: 0, edges: 0 })
  const handleVisibleChange = useCallback((c: { nodes: number; edges: number }) => setVisibleCounts(c), [])

  // 描画に渡す線（インスタンス同士とクラスを含む分を1つに均したもの）
  const edges = useMemo(
    () => buildGraphEdges(triplets, classTriplets, instById, classNameById),
    [triplets, classTriplets, instById, classNameById],
  )
  return (
    <div className="flex h-full flex-col">
      <TopBar group="ナレッジグラフ作成" title="グラフビュー">
        {!loading && currentProject && edges.length > 0 && (
          <span className="text-xs text-muted-foreground">
            ノード {visibleCounts.nodes}・エッジ {visibleCounts.edges}
            {visibleCounts.edges < edges.length && `（全${edges.length}）`}
          </span>
        )}
      </TopBar>
      <div className="flex-1 overflow-hidden">
        {loading && edges.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 bg-[#0a0b14]">
            <Loader2 className="h-16 w-16 animate-spin text-indigo-300" />
            <p className="text-sm text-indigo-100/80">読込中...</p>
          </div>
        ) : !currentProject ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            プロジェクトを選択してください
          </div>
        ) : (
          <TripletGraph
            edges={edges}
            classNameById={classNameById}
            attrNameById={attrNameById}
            conditionSlotsByRelationId={conditionSlotsByRelationId}
            hueByClassId={hueByClassId}
            hueByRelationId={hueByRelationId}
            rootClassIdById={rootClassIdById}
            relationOrder={relationOrder}
            onVisibleChange={handleVisibleChange}
          />
        )}
      </div>
    </div>
  )
}
