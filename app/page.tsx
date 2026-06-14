"use client"

import { useState } from "react"
import { Sidebar, type ScreenId } from "@/components/sidebar"
import { DashboardScreen } from "@/components/dashboard-screen"
import { ClassesScreen } from "@/components/classes-screen"
import { RelationsScreen } from "@/components/relations-screen"
import { ReviewScreen } from "@/components/review-screen"
import { InstancesScreen } from "@/components/instances-screen"
import { ProjectWelcomeScreen } from "@/components/project-welcome-screen"
import { ProjectProvider } from "@/app/project-context"
import { useProject } from "@/app/project-context"

function AppContent() {
  const { currentProject, loading } = useProject()
  const [screen, setScreen] = useState<ScreenId>("dashboard")
  const [initialSelectId, setInitialSelectId] = useState<string | undefined>(undefined)

  const navigate = (s: ScreenId, id?: string) => {
    setInitialSelectId(id)
    setScreen(s)
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar active={screen} onNavigate={(s) => navigate(s)} />
      <main className="flex-1 overflow-hidden">
        {!loading && !currentProject ? (
          <ProjectWelcomeScreen />
        ) : (
          <>
            {screen === "dashboard" && <DashboardScreen onNavigate={navigate} />}
            {screen === "classes" && <ClassesScreen initialSelectedId={initialSelectId} />}
            {screen === "relations" && <RelationsScreen initialSelectedId={initialSelectId} />}
            {screen === "review" && <ReviewScreen />}
            {screen === "instances" && <InstancesScreen initialSelectedClassId={initialSelectId} />}
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
