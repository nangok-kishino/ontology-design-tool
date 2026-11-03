"use client"

import { useEffect, useState } from "react"
import { Sidebar, type ScreenId } from "@/components/sidebar"
import { LabelsScreen } from "@/components/labels-screen"
import { RelationshipTypesScreen } from "@/components/relationship-types-screen"
import { NodesScreen } from "@/components/nodes-screen"
import { RelationshipsScreen } from "@/components/relationships-screen"
import { LabelSynonymsScreen } from "@/components/label-synonyms-screen"
import { SchemaViewScreen } from "@/components/schema-view-screen"
import { GraphDataViewScreen } from "@/components/graph-data-view-screen"
import { ExportScreen } from "@/components/export-screen"
import { LlmAnalysisScreen } from "@/components/llm-analysis-screen"
import { ProjectWelcomeScreen } from "@/components/project-welcome-screen"
import { OntologyInfoScreen } from "@/components/ontology-info-screen"
import { KnowledgeScopeScreen } from "@/components/knowledge-scope-screen"
import { ProjectProvider } from "@/app/project-context"
import { useProject } from "@/app/project-context"

// 画面ごとに、一度開いたら表示を切り替えても状態を保つ（隠すだけで外さない）。
// まだ開いていない画面は作らない。プロジェクトに関係しない説明の画面（下部の2つ）は都度表示する。
type MountedScreen = Exclude<ScreenId, "ontology-info" | "knowledge-scope">

function AppContent() {
  const { currentProject, loading } = useProject()
  // プロジェクトを開いた直後は LLM による解析（文書からスキーマとグラフデータの候補を出すところから始める）
  const [screen, setScreen] = useState<ScreenId>("llm-analysis")
  const [initialSelectId, setInitialSelectId] = useState<string | undefined>(undefined)
  const [visited, setVisited] = useState<Set<MountedScreen>>(new Set(["llm-analysis"]))

  // プロジェクトを選んだら（選び直したときも）、最初の画面は LLM による解析
  const projectId = currentProject?.id
  useEffect(() => {
    if (!projectId) return
    setScreen((prev) => (prev === "ontology-info" || prev === "knowledge-scope" ? prev : "llm-analysis"))
    setInitialSelectId(undefined)
  }, [projectId])

  const navigate = (s: ScreenId, id?: string) => {
    setInitialSelectId(id)
    setScreen(s)
    if (s !== "ontology-info" && s !== "knowledge-scope") setVisited((prev) => (prev.has(s) ? prev : new Set(prev).add(s)))
  }

  // 開いたことのある画面だけを置き、今の画面だけを見せる
  const slot = (id: MountedScreen, node: React.ReactNode) =>
    visited.has(id) && <div className={screen === id ? "h-full" : "hidden"}>{node}</div>

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar active={screen} onNavigate={(s) => navigate(s)} />
      <main className="flex-1 overflow-hidden">
        {/* 説明の画面は、開いている間だけ出す。下の各画面は外さずに隠すだけ（解析中などの状態を失わないため） */}
        {screen === "ontology-info" && <OntologyInfoScreen />}
        {screen === "knowledge-scope" && <KnowledgeScopeScreen />}
        {/* プロジェクト一覧を読み込んでいる間は何も出さない（選ぶ前に各画面が見えてしまわないように） */}
        {loading ? null : !currentProject ? (
          screen !== "ontology-info" && screen !== "knowledge-scope" && <ProjectWelcomeScreen />
        ) : (
          <>
            {slot("llm-analysis", <LlmAnalysisScreen active={screen === "llm-analysis"} />)}
            {slot("labels", <LabelsScreen initialSelectedId={initialSelectId} active={screen === "labels"} />)}
            {slot("rel-types", <RelationshipTypesScreen initialSelectedId={initialSelectId} active={screen === "rel-types"} />)}
            {slot("label-synonyms", <LabelSynonymsScreen active={screen === "label-synonyms"} />)}
            {slot("schema-view", <SchemaViewScreen active={screen === "schema-view"} />)}
            {slot("nodes", <NodesScreen initialSelectedLabelId={initialSelectId} active={screen === "nodes"} />)}
            {slot("relationships", <RelationshipsScreen active={screen === "relationships"}
              focusId={screen === "relationships" ? initialSelectId : undefined} />)}
            {slot("graph-view", <GraphDataViewScreen active={screen === "graph-view"}
              onOpenRelationship={(id) => navigate("relationships", id)} />)}
            {slot("export", <ExportScreen active={screen === "export"} />)}
          </>
        )}
      </main>
    </div>
  )
}

export default function Page() {
  return (
    <ProjectProvider>
      <AppContent />
    </ProjectProvider>
  )
}
