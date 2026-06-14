"use client"

import { createContext, useContext, useState, useEffect, type ReactNode } from "react"
import type { Project } from "@/lib/types"

type ProjectContextType = {
  projects: Project[]
  currentProject: Project | null
  setCurrentProject: (p: Project) => void
  clearCurrentProject: () => void
  refreshProjects: () => Promise<void>
  loading: boolean
}

const ProjectContext = createContext<ProjectContextType | null>(null)

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [currentProject, setCurrentProjectState] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchProjects = async (): Promise<Project[]> => {
    const data: Project[] = await fetch("/api/projects").then((r) => r.json())
    setProjects(data)
    return data
  }

  useEffect(() => {
    fetchProjects().finally(() => setLoading(false))
  }, [])

  const setCurrentProject = (p: Project) => {
    setCurrentProjectState(p)
  }

  const clearCurrentProject = () => {
    setCurrentProjectState(null)
  }

  const refreshProjects = async () => {
    const data = await fetchProjects()
    if (currentProject && !data.find((p) => p.id === currentProject.id)) {
      setCurrentProjectState(null)
    }
  }

  return (
    <ProjectContext.Provider value={{ projects, currentProject, setCurrentProject, clearCurrentProject, refreshProjects, loading }}>
      {children}
    </ProjectContext.Provider>
  )
}

export function useProject() {
  const ctx = useContext(ProjectContext)
  if (!ctx) throw new Error("useProject must be used within ProjectProvider")
  return ctx
}
