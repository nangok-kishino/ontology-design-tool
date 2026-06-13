"use client"

import { useState } from "react"
import { Sidebar, type ScreenId } from "@/components/sidebar"
import { DashboardScreen } from "@/components/dashboard-screen"
import { ClassesScreen } from "@/components/classes-screen"
import { RelationsScreen } from "@/components/relations-screen"
import { ReviewScreen } from "@/components/review-screen"
import { InstancesScreen } from "@/components/instances-screen"

export default function Page() {
  const [screen, setScreen] = useState<ScreenId>("dashboard")

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar active={screen} onNavigate={setScreen} />
      <main className="flex-1 overflow-hidden">
        {screen === "dashboard" && <DashboardScreen />}
        {screen === "classes" && <ClassesScreen />}
        {screen === "relations" && <RelationsScreen />}
        {screen === "review" && <ReviewScreen />}
        {screen === "instances" && <InstancesScreen />}
      </main>
    </div>
  )
}
