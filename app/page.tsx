"use client"

import { useState } from "react"
import { Sidebar, type ScreenId } from "@/components/sidebar"
import { DashboardScreen } from "@/components/dashboard-screen"
import { ClassesScreen } from "@/components/classes-screen"
import { RelationsScreen } from "@/components/relations-screen"
import { ReviewScreen } from "@/components/review-screen"
import { InstancesScreen } from "@/components/instances-screen"
import { TripletsScreen } from "@/components/triplets-screen"
import { TripletReviewScreen } from "@/components/triplet-review-screen"
import { GraphScreen } from "@/components/graph-screen"
import { ProjectWelcomeScreen } from "@/components/project-welcome-screen"
import { OntologyInfoScreen } from "@/components/ontology-info-screen"
import { ProjectProvider } from "@/app/project-context"
import { useProject } from "@/app/project-context"

function AppContent() {
  const { currentProject, loading } = useProject()
  const [screen, setScreen] = useState<ScreenId>("dashboard")
  const [initialSelectId, setInitialSelectId] = useState<string | undefined>(undefined)
  const [hasVisitedClasses, setHasVisitedClasses] = useState(false)
  const [hasVisitedRelations, setHasVisitedRelations] = useState(false)
  const [hasVisitedInstances, setHasVisitedInstances] = useState(false)
  const [hasVisitedReview, setHasVisitedReview] = useState(false)
  const [hasVisitedTriplets, setHasVisitedTriplets] = useState(false)
  const [hasVisitedTripletReview, setHasVisitedTripletReview] = useState(false)
  const [hasVisitedGraph, setHasVisitedGraph] = useState(false)

  const navigate = (s: ScreenId, id?: string) => {
    setInitialSelectId(id)
    setScreen(s)
    if (s === "classes") setHasVisitedClasses(true)
    if (s === "relations") setHasVisitedRelations(true)
    if (s === "instances") setHasVisitedInstances(true)
    if (s === "review") setHasVisitedReview(true)
    if (s === "triplets") setHasVisitedTriplets(true)
    if (s === "triplet-review") setHasVisitedTripletReview(true)
    if (s === "graph") setHasVisitedGraph(true)
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar active={screen} onNavigate={(s) => navigate(s)} />
      <main className="flex-1 overflow-hidden">
        {screen === "ontology-info" ? (
          <OntologyInfoScreen />
        ) : !loading && !currentProject ? (
          <ProjectWelcomeScreen />
        ) : (
          <>
            {screen === "dashboard" && <DashboardScreen onNavigate={navigate} />}
            {hasVisitedClasses && (
              <div className={screen === "classes" ? "h-full" : "hidden"}>
                <ClassesScreen initialSelectedId={initialSelectId} active={screen === "classes"} />
              </div>
            )}
            {hasVisitedRelations && (
              <div className={screen === "relations" ? "h-full" : "hidden"}>
                <RelationsScreen initialSelectedId={initialSelectId} active={screen === "relations"} />
              </div>
            )}
            {hasVisitedInstances && (
              <div className={screen === "instances" ? "h-full" : "hidden"}>
                <InstancesScreen initialSelectedClassId={initialSelectId} active={screen === "instances"} />
              </div>
            )}
            {hasVisitedReview && (
              <div className={screen === "review" ? "h-full" : "hidden"}>
                <ReviewScreen active={screen === "review"} />
              </div>
            )}
            {hasVisitedTriplets && (
              <div className={screen === "triplets" ? "h-full" : "hidden"}>
                <TripletsScreen active={screen === "triplets"} />
              </div>
            )}
            {hasVisitedTripletReview && (
              <div className={screen === "triplet-review" ? "h-full" : "hidden"}>
                <TripletReviewScreen active={screen === "triplet-review"} />
              </div>
            )}
            {hasVisitedGraph && (
              <div className={screen === "graph" ? "h-full" : "hidden"}>
                <GraphScreen active={screen === "graph"} />
              </div>
            )}
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
