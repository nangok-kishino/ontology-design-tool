"use client"

// ラベル同義語（スキーマ設計）。ラベルごとの同義語を1画面で一覧・編集する。
//
// データはラベル管理の詳細パネルと同じ Label.synonyms で、この画面はその横断ビュー。
// 1件ずつ開いて回らずに一気に埋められるようにするためだけのもので、別の辞書ではない。
//
// 【同義語と別名の違い】同義語は「種類」の言い換え（商品ラベルの「製品」）、
// 別名は「個体」の言い換え（ポンプA が吸収した P-A）。後者はノード名寄せで扱う。

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
import { useListOrder } from "@/components/use-list-order"
import type { Label } from "@/lib/graph-types"

type Filter = "all" | "with" | "without"

export function LabelSynonymsScreen({ active }: { active?: boolean }) {
  const { currentProject, loading: projectLoading } = useProject()
  const projectId = currentProject?.id

  const [labels, setLabels] = useState<Label[]>([])
  const [loading, setLoading] = useState(true)
  // 編集中の同義語（labelId → 同義語）。保存済みと違う行にだけ「保存」を出す。
  const [drafts, setDrafts] = useState<Record<string, string[]>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState<Filter>("all")
  const [query, setQuery] = useState("")

  const fetchLabels = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/labels?projectId=${projectId}`)
      const data = await res.json()
      setLabels(Array.isArray(data) ? data : [])
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (projectLoading) return
    setLabels([]); setDrafts({}); setErrors({})
    setLoading(!!projectId)
  }, [projectId, projectLoading])

  useEffect(() => {
    if (active && projectId) fetchLabels()
  }, [active, projectId, fetchLabels])

  const draftOf = (l: Label) => drafts[l.id] ?? l.synonyms ?? []
  const isDirty = (l: Label) => draftOf(l).join("\n") !== (l.synonyms ?? []).join("\n")

  // ラベル管理と同じ並び
  const { ordered: orderedLabels } = useListOrder(labels, projectId, "class", active)
  const rows = useMemo(() => {
    const q = normalizeName(query)
    return orderedLabels
      // 予約ラベルは文書中で指されるものではないので出さない
      .filter((l) => !l.system)
      .filter((l) => {
        const n = (l.synonyms ?? []).length
        if (filter === "with" && n === 0) return false
        if (filter === "without" && n > 0) return false
        if (!q) return true
        return [l.name, l.nameEn ?? "", ...(l.synonyms ?? [])].some((t) => normalizeName(t).includes(q))
      })
  }, [orderedLabels, filter, query])

  const synonymCount = labels.reduce((sum, l) => sum + (l.synonyms ?? []).length, 0)

  const handleSave = async (l: Label) => {
    setSavingId(l.id)
    setErrors((e) => ({ ...e, [l.id]: "" }))
    try {
      const res = await fetch(`/api/labels/${l.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ synonyms: draftOf(l) }),
      })
      if (!res.ok) {
        // 他ラベルの名前・同義語と重複している場合など（409）
        const err = await res.json().catch(() => ({}))
        setErrors((e) => ({ ...e, [l.id]: err.error ?? "保存に失敗しました" }))
        return
      }
      const updated: Label = await res.json()
      setLabels((list) => list.map((x) => (x.id === updated.id ? updated : x)))
      setDrafts((d) => {
        const { [l.id]: _removed, ...rest } = d
        return rest
      })
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar group="スキーマ設計" title="ラベル同義語">
        {!loading && currentProject && labels.length > 0 && (
          <span className="text-xs text-muted-foreground">
            ラベル {rows.length}・同義語 {synonymCount}
          </span>
        )}
      </TopBar>

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="space-y-1 px-6 pt-4 pb-3">
          <h2 className="text-base font-semibold text-foreground">ラベルの同義語</h2>
          <p className="text-xs text-muted-foreground">
            文書中でそのラベルを指す別の呼び方を登録します。抽出のときに読み替えに使います
            （例：商品ラベルに「製品」を登録すると、「製品名：アクトチェア」のアクトチェアを商品のノードとして抽出）。
            個体の言い換えである「別名」はノード名寄せで扱います。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 px-6 pb-3 text-xs">
          <div className="relative w-64">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="ラベル名・同義語で検索" className="h-8 pl-7" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">表示フィルター：</span>
            {([
              { key: "all", label: "全て" },
              { key: "with", label: "同義語あり" },
              { key: "without", label: "同義語なし" },
            ] as { key: Filter; label: string }[]).map((opt) => (
              <button key={opt.key} type="button"
                className={cn(
                  "rounded-full border px-2.5 py-0.5 transition-colors",
                  filter === opt.key
                    ? "border-indigo-400 bg-indigo-100 text-indigo-800 dark:border-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
                onClick={() => setFilter(opt.key)}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-auto px-6 pb-6">
          {loading && labels.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : labels.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">
              {currentProject ? "ラベルが登録されていません" : "プロジェクトを選択してください"}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="w-[26%] font-semibold text-foreground">ラベル</TableHead>
                    <TableHead className="font-semibold text-foreground">同義語（Enterで追加）</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((l) => (
                    <TableRow key={l.id} className="align-top">
                      <TableCell className="py-2.5">
                        <span className="block truncate font-medium text-foreground" title={l.name}>{l.name}</span>
                        {l.nameEn && <span className="block truncate text-xs text-muted-foreground">{l.nameEn}</span>}
                      </TableCell>
                      <TableCell className="whitespace-normal py-2">
                        <SynonymInput
                          value={draftOf(l)}
                          ownName={l.name}
                          placeholder="例：製品"
                          onChange={(next) => setDrafts((d) => ({ ...d, [l.id]: next }))}
                        />
                        {errors[l.id] && <p className="mt-1 text-xs text-destructive">{errors[l.id]}</p>}
                      </TableCell>
                      <TableCell className="py-2 text-right">
                        {isDirty(l) && (
                          <Button size="sm" className="h-8 gap-1.5"
                            onClick={() => handleSave(l)} disabled={savingId === l.id}>
                            {savingId === l.id
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Save className="h-3.5 w-3.5" />}
                            保存
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">
                        条件に合うラベルがありません
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
