"use client"

// エクスポート（グラフデータ作成）。旧グラフビューの枠を置き換える画面。
//
// 「きれいに・正しくグラフを作る」の実体はここ。Neo4j へ渡す前に、
// 直したほうがよいところを並べて見せ、そのうえで Cypher を書き出す。
// できあがったグラフの探索・可視化は Neo4j 側の仕事（docs/graph-model.md §1）。

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { TopBar } from "@/components/top-bar"
import { CheckCard, toggleKey } from "@/components/check-card"
import { cn } from "@/lib/utils"
import { buildCypher, downloadText, runChecks, type CheckResult, type GraphData } from "@/lib/graph-cypher"
import { Check, Copy, Download, Loader2, RefreshCw } from "lucide-react"
import { useProject } from "@/app/project-context"

const EMPTY: GraphData = { labels: [], relTypes: [], nodes: [], relationships: [], propertyDefs: [] }

export function ExportScreen({ active }: { active?: boolean }) {
  const { currentProject, loading: projectLoading } = useProject()
  const projectId = currentProject?.id

  const [data, setData] = useState<GraphData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState(false)

  const fetchAll = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const [labels, relTypes, nodes, relationships, propertyDefs] = await Promise.all([
        fetch(`/api/labels?projectId=${projectId}`).then((r) => r.json()),
        fetch(`/api/relationship-types?projectId=${projectId}`).then((r) => r.json()),
        fetch(`/api/nodes?projectId=${projectId}`).then((r) => r.json()),
        fetch(`/api/relationships?projectId=${projectId}`).then((r) => r.json()),
        fetch(`/api/properties?projectId=${projectId}`).then((r) => r.json()),
      ])
      setData({
        labels: Array.isArray(labels) ? labels : [],
        relTypes: Array.isArray(relTypes) ? relTypes : [],
        nodes: Array.isArray(nodes) ? nodes : [],
        relationships: Array.isArray(relationships) ? relationships : [],
        propertyDefs: Array.isArray(propertyDefs) ? propertyDefs : [],
      })
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (projectLoading) return
    setData(EMPTY)
    setLoading(!!projectId)
  }, [projectId, projectLoading])

  useEffect(() => {
    if (active && projectId) fetchAll()
  }, [active, projectId, fetchAll])

  const checks = useMemo<CheckResult[]>(() => runChecks(data), [data])
  const cypher = useMemo(() => buildCypher(data), [data])
  const blockingCount = checks.filter((c) => c.blocking).reduce((n, c) => n + c.items.length, 0)
  // 使われていない定義（category: schema）はグラフデータ確認で見せる。出力には影響しないため
  const exportChecks = checks.filter((c) => c.category === "export")

  const liveNodeCount = data.nodes.filter((n) => n.status !== "merged").length

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(cypher)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error(err)
    }
  }

  const handleDownload = () => {
    const name = (currentProject?.name ?? "graph").replace(/[\\/:*?"<>|]/g, "_")
    downloadText(`${name}.cypher`, cypher)
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar group="グラフデータ作成" title="エクスポート">
        {!loading && currentProject && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>ノード {liveNodeCount}・リレーションシップ {data.relationships.length}</span>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-transparent"
              onClick={fetchAll} disabled={loading}>
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />再チェック
            </Button>
          </div>
        )}
      </TopBar>

      <div className="flex-1 overflow-auto px-6 py-4">
        {loading && data.labels.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : !currentProject ? (
          <p className="p-4 text-center text-sm text-muted-foreground">プロジェクトを選択してください</p>
        ) : (
          <div className="space-y-6">
            {/* エクスポートに関わるチェック */}
            <section className="space-y-3">
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-foreground">エクスポート前チェック</h2>
                <p className="text-xs text-muted-foreground">
                  Neo4j に入るデータで、直したほうがよいところです。
                  {blockingCount === 0
                    ? "直すべきものは見つかりませんでした。"
                    : `スキーマと食い違うものが ${blockingCount}件あります。`}
                </p>
              </div>
              <div className="space-y-2">
                {exportChecks.map((c) => (
                  <CheckCard key={c.key} check={c} info={false} open={openKeys.has(c.key)}
                    onToggle={() => setOpenKeys((prev) => toggleKey(prev, c.key))} />
                ))}
              </div>
            </section>

            {/* Cypher */}
            <section className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="space-y-1">
                  <h2 className="text-base font-semibold text-foreground">Cypher</h2>
                  <p className="text-xs text-muted-foreground">
                    すべて MERGE で出すので、同じものを何度流し込んでも重複しません。
                    Neo4j Browser や cypher-shell に貼って実行できます。
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-transparent"
                    onClick={handleCopy} disabled={!cypher}>
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? "コピーしました" : "コピー"}
                  </Button>
                  <Button size="sm" className="h-8 gap-1.5" onClick={handleDownload} disabled={!cypher}>
                    <Download className="h-3.5 w-3.5" />Cypherをエクスポート
                  </Button>
                </div>
              </div>
              <pre className="max-h-[32rem] overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-xs leading-relaxed text-foreground">
                {cypher || "出力するものがありません"}
              </pre>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
