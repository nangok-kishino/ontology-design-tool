"use client"

// 同義語辞書（オントロジー設計）。クラスごとの同義語を1画面で一覧・編集する。
//   データ自体は各クラスの synonyms（クラス管理の編集パネルと同じもの）で、この画面は横断ビュー。
//   オントロジー抽出・トリプレット抽出では、この同義語を使って文書中の語をクラスへ読み替える。

import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, Save, Search } from "lucide-react"
import { TopBar } from "@/components/top-bar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { SynonymInput } from "@/components/synonym-input"
import { cn } from "@/lib/utils"
import { normalizeName } from "@/lib/normalize"
import { useProject } from "@/app/project-context"
import type { OntologyClass } from "@/lib/types"

type Filter = "all" | "with" | "without"

export function SynonymsScreen({ active }: { active?: boolean }) {
  const { currentProject, loading: projectLoading } = useProject()
  const [classes, setClasses] = useState<OntologyClass[]>([])
  const [loading, setLoading] = useState(true)
  // 編集中の同義語（classId → 同義語）。保存済みの値と違う行だけ「保存」を出す。
  const [drafts, setDrafts] = useState<Record<string, string[]>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState<Filter>("all")
  const [query, setQuery] = useState("")

  const fetchClasses = useCallback(async () => {
    if (!currentProject) return
    setLoading(true)
    try {
      const res = await fetch(`/api/classes?projectId=${currentProject.id}`)
      const data = await res.json()
      setClasses(Array.isArray(data) ? data : [])
    } finally {
      setLoading(false)
    }
  }, [currentProject?.id])

  // プロジェクト切替時のみデータを捨てる。取得は下の表示時 effect に任せる。
  useEffect(() => {
    if (projectLoading) return
    setClasses([]); setDrafts({}); setErrors({})
    setLoading(!!currentProject)
  }, [currentProject?.id, projectLoading])

  useEffect(() => {
    if (active && currentProject) fetchClasses()
  }, [active, currentProject?.id, fetchClasses])

  const draftOf = (c: OntologyClass) => drafts[c.id] ?? c.synonyms ?? []
  const isDirty = (c: OntologyClass) => draftOf(c).join("\n") !== (c.synonyms ?? []).join("\n")

  const rows = useMemo(() => {
    const q = normalizeName(query)
    return [...classes]
      .sort((a, b) => a.name.localeCompare(b.name, "ja"))
      .filter((c) => {
        const n = (c.synonyms ?? []).length
        if (filter === "with" && n === 0) return false
        if (filter === "without" && n > 0) return false
        if (!q) return true
        return [c.name, c.nameEn ?? "", ...(c.synonyms ?? [])].some((t) => normalizeName(t).includes(q))
      })
  }, [classes, filter, query])

  const synonymCount = classes.reduce((sum, c) => sum + (c.synonyms ?? []).length, 0)

  const handleSave = async (c: OntologyClass) => {
    setSavingId(c.id)
    setErrors((e) => ({ ...e, [c.id]: "" }))
    try {
      const res = await fetch(`/api/classes/${c.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ synonyms: draftOf(c) }),
      })
      if (!res.ok) {
        // 他クラスのクラス名・同義語と重複している場合など（409）
        const err = await res.json().catch(() => ({}))
        setErrors((e) => ({ ...e, [c.id]: err.error ?? "保存に失敗しました" }))
        return
      }
      const updated: OntologyClass = await res.json()
      setClasses((list) => list.map((x) => (x.id === updated.id ? updated : x)))
      setDrafts((d) => {
        const { [c.id]: _, ...rest } = d
        return rest
      })
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar group="オントロジー設計" title="同義語辞書">
        {!loading && currentProject && classes.length > 0 && (
          <span className="text-xs text-muted-foreground">クラス {classes.length}・同義語 {synonymCount}</span>
        )}
      </TopBar>
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="space-y-1 px-6 pt-4 pb-3">
          <h2 className="text-base font-semibold text-foreground">クラスの同義語</h2>
          <p className="text-xs text-muted-foreground">
            文書中でクラスを指す別の呼び方を登録します。オントロジー抽出・トリプレット抽出で読み替えに使います
            （例：商品クラスに「製品」を登録すると、「製品名：アクトチェア」のアクトチェアを商品のインスタンスとして抽出）。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 px-6 pb-3 text-xs">
          <div className="relative w-64">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="クラス名・同義語で検索" className="h-8 pl-7" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">表示フィルター：</span>
            {([
              { key: "all", label: "全て" },
              { key: "with", label: "同義語あり" },
              { key: "without", label: "同義語なし" },
            ] as { key: Filter; label: string }[]).map((opt) => (
              <button
                key={opt.key}
                type="button"
                className={cn(
                  "rounded-full border px-2.5 py-0.5 transition-colors",
                  filter === opt.key
                    ? "border-indigo-400 bg-indigo-100 text-indigo-800 dark:border-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
                onClick={() => setFilter(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-auto px-6 pb-6">
          {loading && classes.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : classes.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">
              {currentProject ? "クラスが登録されていません" : "プロジェクトを選択してください"}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="w-[26%] font-semibold text-foreground">クラス</TableHead>
                    <TableHead className="font-semibold text-foreground">同義語（Enterで追加）</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((c) => (
                    <TableRow key={c.id} className="align-top">
                      <TableCell className="py-2.5">
                        <span className="block truncate font-medium text-foreground" title={c.name}>{c.name}</span>
                        {c.nameEn && <span className="block truncate text-xs text-muted-foreground">{c.nameEn}</span>}
                      </TableCell>
                      <TableCell className="py-2 whitespace-normal">
                        <SynonymInput
                          value={draftOf(c)}
                          ownName={c.name}
                          placeholder="例：製品"
                          onChange={(next) => setDrafts((d) => ({ ...d, [c.id]: next }))}
                        />
                        {errors[c.id] && <p className="mt-1 text-xs text-destructive">{errors[c.id]}</p>}
                      </TableCell>
                      <TableCell className="py-2 text-right">
                        {isDirty(c) && (
                          <Button size="sm" className="h-8 gap-1.5" onClick={() => handleSave(c)} disabled={savingId === c.id}>
                            {savingId === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                            保存
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">
                        条件に合うクラスがありません
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
