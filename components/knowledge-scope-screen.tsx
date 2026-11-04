"use client"

// 知見の分類について。右ペインの中でページを切り替えて見せる。
// 「既存知見の何をグラフにするか？」は、グラフにするか文章のままベクトル RAG で扱うかの基準（lib/knowledge-scope.ts）。
// LLM による解析も同じ基準に従う。「最適な検索手段」は、貯めた知見を問いの種類ごとにどう引くか（lib/search-methods.ts）。

import { useState } from "react"
import { Scale, Search } from "lucide-react"
import { TopBar } from "@/components/top-bar"
import { cn } from "@/lib/utils"
import { KNOWLEDGE_SCOPE } from "@/lib/knowledge-scope"
import { SEARCH_METHODS, type SearchMethod } from "@/lib/search-methods"

type PageId = "graph-or-rag" | "search-methods"

const PAGES: { id: PageId; label: string; icon: React.ElementType }[] = [
  { id: "graph-or-rag", label: "既存知見の何をグラフにするか？", icon: Scale },
  { id: "search-methods", label: "最適な検索手段", icon: Search },
]

// 検索手段ごとの色。グラフ＋RAG は切り分け基準の「グラフ」、RAG は「ベクトルRAG」と同じ色に合わせる。
const METHOD_STYLES: Record<SearchMethod, string> = {
  "従来型インデックス検索": "border-zinc-200 bg-zinc-50 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-200",
  "RAG": "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  "グラフ＋RAG": "border-indigo-200 bg-indigo-50 text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-200",
}

function GraphOrRagPage() {
  return (
    <div className="max-w-5xl space-y-4">
      <p className="text-sm leading-relaxed text-muted-foreground">
        既存知見をグラフデータ化する際に、どんな知見を、グラフにするか、文章のままベクトルRAGで扱うかの基準です。本アプリのLLMによる解析も、この基準に従ってスキーマ/グラフデータの候補を出します。
      </p>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className="w-48 px-4 py-2.5 font-semibold text-foreground">知見のタイプ</th>
              <th className="w-32 px-4 py-2.5 font-semibold text-foreground">どちらで扱うか</th>
              <th className="px-4 py-2.5 font-semibold text-foreground">理由・具体例</th>
            </tr>
          </thead>
          <tbody>
            {KNOWLEDGE_SCOPE.map((r) => (
              <tr key={r.kind} className="border-t border-border align-top">
                <td className="px-4 py-3 font-medium text-foreground">{r.kind}</td>
                <td className="px-4 py-3">
                  <span className={cn(
                    "inline-block whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium",
                    r.handling === "ベクトルRAG"
                      ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                      : "border-indigo-200 bg-indigo-50 text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-200",
                  )}>
                    {r.handling}
                  </span>
                </td>
                <td className="px-4 py-3 leading-relaxed text-foreground">
                  {r.reason}
                  <span className="mt-1 block text-muted-foreground">例：{r.example}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SearchMethodsPage() {
  return (
    <div className="max-w-5xl space-y-4">
      <p className="text-sm leading-relaxed text-muted-foreground">
        問いの種類ごとに、どの検索手段が適しているかの一覧です。同じ知見でも、何を聞きたいかで引き方が変わります。
      </p>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className="w-40 px-4 py-2.5 font-semibold text-foreground">検索手段</th>
              <th className="w-56 px-4 py-2.5 font-semibold text-foreground">問いの種類</th>
              <th className="px-4 py-2.5 font-semibold text-foreground">理由</th>
              <th className="w-72 px-4 py-2.5 font-semibold text-foreground">検索プロンプト例</th>
            </tr>
          </thead>
          <tbody>
            {SEARCH_METHODS.map((r, i) => {
              // 同じ検索手段が続く行はセルをまとめて、手段ごとのかたまりが見えるようにする
              const isFirstOfMethod = i === 0 || SEARCH_METHODS[i - 1].method !== r.method
              const span = SEARCH_METHODS.filter((x) => x.method === r.method).length
              return (
                <tr
                  key={`${r.method}-${r.question}`}
                  className={cn("align-top", isFirstOfMethod ? "border-t-2 border-border" : "border-t border-border")}
                >
                  {isFirstOfMethod && (
                    <td rowSpan={span} className="border-r border-border px-4 py-3">
                      <span className={cn(
                        "inline-block whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium",
                        METHOD_STYLES[r.method],
                      )}>
                        {r.method}
                      </span>
                    </td>
                  )}
                  <td className="px-4 py-3 font-medium leading-relaxed text-foreground">{r.question}</td>
                  <td className="px-4 py-3 leading-relaxed text-foreground">{r.reason}</td>
                  <td className="px-4 py-3">
                    <ul className="space-y-1.5">
                      {r.examples.map((e) => (
                        <li key={e} className="leading-relaxed text-muted-foreground">
                          「{e}」
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="space-y-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
        <p>
          グラフ＋RAGが使えるのは、「既存知見の何をグラフにするか？」で「グラフ」と判定し、グラフ化した知見に限られます。グラフ化していない知見については、従来型インデックス検索とRAGで対応します。
        </p>
        <p>
          1つの問いに複数の要素が含まれる場合（例：「EUで使えない部品を挙げ、それぞれの代替部品の採用経緯も示して」）は、グラフ＋RAGで対象を特定したうえで、RAGで経緯を補う組み合わせになると考えます。
        </p>
      </div>
    </div>
  )
}

export function KnowledgeScopeScreen() {
  const [selected, setSelected] = useState<PageId>("graph-or-rag")
  const current = PAGES.find((p) => p.id === selected) ?? PAGES[0]

  return (
    <div className="flex h-full flex-col">
      <TopBar group="知見の分類について" title={current.label} />
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-72 shrink-0 overflow-y-auto border-r border-border bg-card px-3 py-4">
          <nav className="space-y-0.5">
            {PAGES.map((page) => {
              const Icon = page.icon
              const isActive = page.id === selected
              return (
                <button
                  key={page.id}
                  onClick={() => setSelected(page.id)}
                  title={page.label}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                    isActive
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{page.label}</span>
                </button>
              )
            })}
          </nav>
        </aside>
        <div className="flex-1 overflow-auto bg-background p-6">
          {selected === "graph-or-rag" ? <GraphOrRagPage /> : <SearchMethodsPage />}
        </div>
      </div>
    </div>
  )
}
