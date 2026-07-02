"use client"

import { useEffect, useState } from "react"
import { BookOpen } from "lucide-react"
import { cn } from "@/lib/utils"
import { TopBar } from "@/components/top-bar"

export function OntologyInfoScreen() {
  const [files, setFiles] = useState<string[]>([])
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch("/api/ontology-docs")
      .then((res) => res.json())
      .then((data: string[]) => {
        if (cancelled) return
        setFiles(data)
        setSelected(data[0])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="flex h-full flex-col">
      <TopBar title="オントロジーについて" />
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-72 shrink-0 overflow-y-auto border-r border-border bg-card px-3 py-4">
          {loading ? (
            <p className="px-2 text-sm text-muted-foreground">読み込み中...</p>
          ) : files.length === 0 ? (
            <p className="px-2 text-sm text-muted-foreground">ドキュメントが見つかりません</p>
          ) : (
            <nav className="space-y-0.5">
              {files.map((file) => {
                const isActive = file === selected
                return (
                  <button
                    key={file}
                    onClick={() => setSelected(file)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                      isActive
                        ? "bg-muted font-medium text-foreground"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                  >
                    <BookOpen className="h-4 w-4 shrink-0" />
                    <span className="truncate">{file}</span>
                  </button>
                )
              })}
            </nav>
          )}
        </aside>
        <div className="flex-1 overflow-hidden bg-background">
          {selected && (
            <iframe
              key={selected}
              src={`/ontology-docs/${encodeURIComponent(selected)}`}
              title={selected}
              className="h-full w-full border-0"
            />
          )}
        </div>
      </div>
    </div>
  )
}
