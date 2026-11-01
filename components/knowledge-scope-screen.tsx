"use client"

// 知見の切り分け基準。文書の中の知見をグラフにするか、文章のままベクトル RAG で扱うかの基準を、
// 人がいつでも確認できるように表示する。LLM による解析も同じ基準（lib/knowledge-scope.ts）に従う。

import { TopBar } from "@/components/top-bar"
import { cn } from "@/lib/utils"
import { KNOWLEDGE_SCOPE } from "@/lib/knowledge-scope"

export function KnowledgeScopeScreen() {
  return (
    <div className="flex h-full flex-col">
      <TopBar title="知見の切り分け基準" />
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-5xl space-y-4">
          <p className="text-sm text-muted-foreground">
            文書の中の知見を、グラフにするか、文章のままベクトルRAGで扱うかの基準です。LLMによる解析も、この基準に従って候補を出します。
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
      </div>
    </div>
  )
}
