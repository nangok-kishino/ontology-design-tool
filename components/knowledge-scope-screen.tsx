"use client"

// 知見の検索について。右ペインの中で4つのページを切り替えて見せる。
// 読み手は知見検索システムを構築する人。問いの種類に応じた検索手段の使い分けはシステムが内部で行うため、
// 問いを入力する人に使い分けを求める書き方はしない。グラフをどう作るべきかも扱わない。
// 表の内容は lib/search-methods.ts、グラフにする知見の基準は LLM による解析と共有の lib/knowledge-scope.ts。

import { useState } from "react"
import { ArrowLeftRight, Hammer, Layers, Search } from "lucide-react"
import { TopBar } from "@/components/top-bar"
import { cn } from "@/lib/utils"
import { KNOWLEDGE_SCOPE, type KnowledgeScopeRow } from "@/lib/knowledge-scope"
import {
  BUILD_METHODS, NOT_FOUND_READINGS, SEARCH_MECHANISMS, SEARCH_METHODS, STORAGE_FORMS,
  type SearchMethod, type StorageForm,
} from "@/lib/search-methods"

type PageId = "storage-forms" | "build-methods" | "search-mechanisms" | "question-types"

const PAGES: { id: PageId; label: string; icon: React.ElementType }[] = [
  { id: "storage-forms", label: "１．情報の持ち方の違い", icon: Layers },
  { id: "build-methods", label: "２．既存知見からの情報の作り方", icon: Hammer },
  { id: "search-mechanisms", label: "３．情報の持ち方と検索手段の対応", icon: ArrowLeftRight },
  { id: "question-types", label: "４．問いの種類に対する最適な検索手段", icon: Search },
]

// 対応する持ち方と検索手段は同じ色にする（インデックス＝従来型インデックス検索、ベクトル＝RAG、グラフ＝グラフ＋RAG）
const TONES = {
  zinc: "border-zinc-200 bg-zinc-50 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-200",
  amber: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  indigo: "border-indigo-200 bg-indigo-50 text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-200",
}

const FORM_TONES: Record<StorageForm, string> = {
  "インデックス": TONES.zinc,
  "ベクトル": TONES.amber,
  "グラフ": TONES.indigo,
}

const METHOD_TONES: Record<SearchMethod, string> = {
  "従来型インデックス検索": TONES.zinc,
  "RAG": TONES.amber,
  "グラフ＋RAG": TONES.indigo,
}

// 切り分け基準のデータは LLM への指示と共有しているため「ベクトルRAG」のまま。画面では持ち方の名前「ベクトル」で出す。
function handlingLabel(handling: KnowledgeScopeRow["handling"]): string {
  return handling === "ベクトルRAG" ? "ベクトル" : handling
}

const TABLE_WRAP = "overflow-hidden rounded-lg border border-border"
const TH = "px-4 py-2.5 font-semibold text-foreground"
const TD = "px-4 py-3 leading-relaxed text-foreground"

function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-block whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium", tone)}>
      {children}
    </span>
  )
}

function Intro({ paragraphs }: { paragraphs: string[] }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed text-foreground">
      {paragraphs.map((p) => <p key={p}>{p}</p>)}
    </div>
  )
}

// 表の説明
function TableGuide({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted-foreground">
      {items.map((item) => <li key={item}>{item}</li>)}
    </ul>
  )
}

// 表の下の補足・注記
function Notes({ items }: { items: string[] }) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
      {items.map((item) => <p key={item}>{item}</p>)}
    </div>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="border-t border-border pt-6 text-base font-semibold text-foreground">{children}</h2>
}

function StorageFormsPage() {
  return (
    <div className="space-y-4">
      <Intro paragraphs={[
        "知見を検索できるようにするには、あらかじめ知見を何らかの形で持っておく必要があります。本アプリが前提とする検索では、インデックス、ベクトル、グラフの3つの持ち方を使い分けます。",
        "持ち方によって、何を単位として登録し、問いとどのように照合するかが異なります。その結果として、得意な問いと不得意な問いが分かれます。このページでは、検索手段の違いを理解する前提として、3つの持ち方の違いを整理します。それぞれをどう作るかは、「２．既存知見からの情報の作り方」で扱います。",
      ]} />
      <TableGuide items={[
        "「持つ単位」は、何を最小の単位として登録するかを示します。",
        "「検索時の判定方法」は、問いと登録内容をどのように照合するかを示します。",
      ]} />
      <div className={TABLE_WRAP}>
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className={cn(TH, "w-36")}>情報の持ち方</th>
              <th className={TH}>持つ単位</th>
              <th className={TH}>検索時の判定方法</th>
              <th className={TH}>得意なこと</th>
              <th className={TH}>不得意なこと</th>
            </tr>
          </thead>
          <tbody>
            {STORAGE_FORMS.map((r) => (
              <tr key={r.form} className="border-t border-border align-top">
                <td className="px-4 py-3"><Badge tone={FORM_TONES[r.form]}>{r.form}</Badge></td>
                <td className={TD}>{r.unit}</td>
                <td className={TD}>{r.matching}</td>
                <td className={TD}>{r.goodAt}</td>
                <td className={TD}>{r.badAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Notes items={[
        "インデックスとグラフは、条件に合うかどうかで結果が決まります。ベクトルは、意味の近さで順位を付けた上位を返します。この判定方法の違いが、確定的な判定や網羅的な列挙に向くかどうかの違いになります。",
        "3つの持ち方は、いずれか1つを選ぶものではありません。同じ文書を複数の持ち方で併せて持つことができます。例えばトラブル報告書であれば、文書番号や発行日を属性としてインデックスに、本文をベクトルに、原因と対策のつながりをグラフに持つことができます。",
      ]} />
    </div>
  )
}

function BuildMethodsPage() {
  return (
    <div className="space-y-4">
      <Intro paragraphs={[
        "インデックス、ベクトル、グラフは、いずれも既存知見をもとに作ります。インデックスとベクトルは、作業のほとんどをシステムに任せられます。一方、グラフは、人が介在しなければ実用的なものは作れません。",
      ]} />
      <TableGuide items={[
        "「作る手順」は、既存の文書からその持ち方の情報を作るまでの作業を示します。",
        "「機械に任せられること」と「人が判断すること」は、その作業のうち、自動で処理できる部分と、人が決める部分を示します。",
        "「知見が増えたとき」は、新しい文書が加わったときに必要になる作業を示します。",
      ]} />
      <div className={TABLE_WRAP}>
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className={cn(TH, "w-36")}>情報の持ち方</th>
              <th className={TH}>作る手順</th>
              <th className={TH}>機械に任せられること</th>
              <th className={TH}>人が判断すること</th>
              <th className={TH}>知見が増えたとき</th>
            </tr>
          </thead>
          <tbody>
            {BUILD_METHODS.map((r) => (
              <tr key={r.form} className="border-t border-border align-top">
                <td className="px-4 py-3"><Badge tone={FORM_TONES[r.form]}>{r.form}</Badge></td>
                <td className={TD}>{r.steps}</td>
                <td className={TD}>{r.byMachine}</td>
                <td className={TD}>{r.byHuman}</td>
                <td className={TD}>{r.whenGrowing}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Notes items={[
        "作り方の違いは、検索の結果にもそのまま表れます。属性の表記がそろっていなければ、従来型インデックス検索の絞り込みに漏れが出ます。断片の単位が問いに合っていなければ、RAGは答えに必要な文脈を取り出せません。グラフに登録していない知見は、グラフ＋RAGでは見つかりません。（各検索手段は「３．情報の持ち方と検索手段の対応」で説明します。）",
      ]} />

      <SectionHeading>グラフにする知見を絞る</SectionHeading>
      <Intro paragraphs={[
        "グラフは、人が介在して作ります。ただし、すべての知見をグラフにする必要はありません。人の手間がかかるうえ、知見の中には、要素と関係に分けるとかえって価値が失われるものもあるためです。次の表は、既存知見をグラフデータ化する際に、どんな知見を、グラフにするか、文章のままベクトルで持つかの基準です。本アプリのLLMによる解析も、この基準に従ってスキーマ／グラフデータの候補を出します。",
      ]} />
      <div className={TABLE_WRAP}>
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className={cn(TH, "w-48")}>知見のタイプ</th>
              <th className={cn(TH, "w-32")}>どちらで持つか</th>
              <th className={TH}>理由・具体例</th>
            </tr>
          </thead>
          <tbody>
            {KNOWLEDGE_SCOPE.map((r) => (
              <tr key={r.kind} className="border-t border-border align-top">
                <td className="px-4 py-3 font-medium text-foreground">{r.kind}</td>
                <td className="px-4 py-3">
                  <Badge tone={r.handling === "ベクトルRAG" ? FORM_TONES["ベクトル"] : FORM_TONES["グラフ"]}>
                    {handlingLabel(r.handling)}
                  </Badge>
                </td>
                <td className={TD}>
                  {r.reason}
                  <span className="mt-1 block text-muted-foreground">例：{r.example}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Notes items={[
        "グラフにしない知見も、捨てるわけではありません。「１．情報の持ち方の違い」で述べたとおり、同じ文書を複数の持ち方で併せて持てます。グラフにしない知見は、ベクトルやインデックスで持ち、RAGや従来型インデックス検索で探します。",
        "「グラフ（骨組み）」とした知見は、事象（部品・現象・原因・対策）とそのつながりだけをグラフに持ち、経緯や考察の文章はベクトルで持ちます。グラフでつながりをたどり、その先の原文で補って答えるのが、グラフ＋RAGです。",
      ]} />
    </div>
  )
}

function SearchMechanismsPage() {
  return (
    <div className="space-y-4">
      <Intro paragraphs={[
        "情報の持ち方は、それだけでは検索になりません。持っている情報を問いと照合し、回答として返すしくみが検索手段です。本アプリでは、検索手段を「従来型インデックス検索」「RAG」「グラフ＋RAG」の3つに分けます。",
        "検索手段の違いは、使う情報の持ち方だけではありません。返ってくるものが、もとの文書にある内容そのものか、LLMが書いた回答の文章か、という違いもあります。この2つの違いから、それぞれの強みと弱みが生まれます。このページでは、各検索手段のしくみと、そこから生まれる強みと弱みを示します。",
      ]} />
      <TableGuide items={[
        "「使う情報の持ち方」は、「１．情報の持ち方の違い」で整理した3つの持ち方のうち、その検索手段が使うものを示します。",
        "「回答の作り方」は、検索した結果を、どのような形で利用者に返すかを示します。",
        "「強み」と「弱み」は、使う情報の持ち方と回答の作り方から、しくみの上で生じるものを示します。",
      ]} />
      <div className={TABLE_WRAP}>
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className={cn(TH, "w-48")}>検索手段</th>
              <th className={cn(TH, "w-36")}>使う情報の持ち方</th>
              <th className={TH}>回答の作り方</th>
              <th className={TH}>強み</th>
              <th className={TH}>弱み</th>
            </tr>
          </thead>
          <tbody>
            {SEARCH_MECHANISMS.map((r) => (
              <tr key={r.method} className="border-t border-border align-top">
                <td className="px-4 py-3"><Badge tone={METHOD_TONES[r.method]}>{r.method}</Badge></td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-1">
                    {r.forms.map((form, i) => (
                      <span key={form} className="flex items-center gap-1">
                        {i > 0 && <span className="text-muted-foreground">＋</span>}
                        <Badge tone={FORM_TONES[form]}>{form}</Badge>
                      </span>
                    ))}
                  </div>
                </td>
                <td className={TD}>{r.answer}</td>
                <td className={TD}>{r.strengths}</td>
                <td className={TD}>{r.weaknesses}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Notes items={[
        "一般にRAGは、取得の手段を問わず「取得した情報をもとにLLMが回答を生成する仕組み」を指します。本アプリでは、ベクトルによって取得するものを「RAG」と呼び、グラフによる照会を組み合わせるものを「グラフ＋RAG」と呼び分けます。",
        "RAGとグラフ＋RAGの回答は、LLMが書いた文章です。回答とあわせて、根拠となった原文を示し、利用者が確かめられるようにしておくことが望ましいと考えます。",
      ]} />

      <SectionHeading>「見つからなかった」ときの読み方</SectionHeading>
      <Intro paragraphs={[
        "同じ「見つからなかった」でも、検索手段によって、そこから言えることが異なります。「見つからなかった」ことを「存在しない」と読み違えないよう、次の点に注意してください。",
      ]} />
      <div className={TABLE_WRAP}>
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className={cn(TH, "w-48")}>検索手段</th>
              <th className={TH}>見つからなかったときに言えること</th>
            </tr>
          </thead>
          <tbody>
            {NOT_FOUND_READINGS.map((r) => (
              <tr key={r.method} className="border-t border-border align-top">
                <td className="px-4 py-3"><Badge tone={METHOD_TONES[r.method]}>{r.method}</Badge></td>
                <td className={TD}>{r.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function QuestionTypesPage() {
  return (
    <div className="space-y-4">
      <Intro paragraphs={[
        "「１．情報の持ち方の違い」から「３．情報の持ち方と検索手段の対応」までで整理したとおり、検索手段ごとに得意な問いが異なります。",
        "実際の検索では、問いの種類に応じた検索手段の使い分けは、システムが内部で行います。問いを入力する人が、どの検索手段を使うかを意識する必要はありません。一方で、適切な知見検索システムを構築するには、問いの種類ごとにどの検索手段が適し、そのために何を整えておく必要があるかを知っておく必要があります。",
        "このページでは、問いを種類ごとに分け、それぞれに適した検索手段と、その検索手段を使うための前提条件、適している理由、検索プロンプト例を示します。",
      ]} />
      <TableGuide items={[
        "「問いの種類」は、利用者が何を求めているかで問いを分けたものです。同じ知見でも、何を求めるかによって適した検索手段が変わります。",
        "「前提条件」は、その検索手段で答えを得るために、あらかじめ整っている必要があるものです。前提条件が整っていない場合、その検索手段では十分な結果が得られない可能性があります。",
        "「検索プロンプト例」は、その種類の問いを実際に入力する場合の例です。",
      ]} />
      <div className={TABLE_WRAP}>
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className={cn(TH, "w-48")}>検索手段</th>
              <th className={cn(TH, "w-48")}>問いの種類</th>
              <th className={TH}>前提条件</th>
              <th className={TH}>理由</th>
              <th className={cn(TH, "w-64")}>検索プロンプト例</th>
            </tr>
          </thead>
          <tbody>
            {SEARCH_METHODS.map((r, i) => {
              // 同じ検索手段が続く行はセルをまとめて、手段ごとのかたまりが見えるようにする
              const prev = SEARCH_METHODS[i - 1]
              const isFirstOfMethod = !prev || prev.method !== r.method
              const span = SEARCH_METHODS.filter((x) => x.method === r.method).length
              const sameAsPrev = !isFirstOfMethod && prev.prerequisite === r.prerequisite
              return (
                <tr
                  key={`${r.method}-${r.question}`}
                  className={cn("align-top", isFirstOfMethod ? "border-t-2 border-border" : "border-t border-border")}
                >
                  {isFirstOfMethod && (
                    <td rowSpan={span} className="border-r border-border px-4 py-3">
                      <Badge tone={METHOD_TONES[r.method]}>{r.method}</Badge>
                    </td>
                  )}
                  <td className={cn(TD, "font-medium")}>{r.question}</td>
                  <td className={cn(TD, sameAsPrev && "text-muted-foreground")}>{sameAsPrev ? "同上" : r.prerequisite}</td>
                  <td className={TD}>{r.reason}</td>
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
      <Notes items={[
        "グラフ＋RAGが使えるのは、「２．既存知見からの情報の作り方」の基準で「グラフ」または「グラフ（骨組み）」と判定し、グラフ化した知見に限られます。グラフ化していない知見は、従来型インデックス検索とRAGで扱います。",
        "1つの問いに複数の要素が含まれる場合（例：「EUで使えない部品を挙げ、それぞれの代替部品の採用経緯も示して」）は、グラフ＋RAGで対象を特定し、RAGで経緯を補う組み合わせになると考えます。",
        "「現象分類」や「対象部品」のように、属性の値とグラフの要素が重なるものがあります。両者で用語をそろえておくと、従来型インデックス検索とグラフ＋RAGを組み合わせやすくなると考えます。",
      ]} />
    </div>
  )
}

const PAGE_CONTENT: Record<PageId, () => React.JSX.Element> = {
  "storage-forms": StorageFormsPage,
  "build-methods": BuildMethodsPage,
  "search-mechanisms": SearchMechanismsPage,
  "question-types": QuestionTypesPage,
}

export function KnowledgeScopeScreen() {
  const [selected, setSelected] = useState<PageId>("storage-forms")
  const current = PAGES.find((p) => p.id === selected) ?? PAGES[0]
  const Content = PAGE_CONTENT[selected]

  return (
    <div className="flex h-full flex-col">
      <TopBar group="知見の検索について" title={current.label} />
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
                  className={cn(
                    // ページ名が長いので、切らずに折り返す
                    "flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left text-sm leading-snug transition-colors",
                    isActive
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{page.label}</span>
                </button>
              )
            })}
          </nav>
        </aside>
        <div className="flex-1 overflow-auto bg-background p-6">
          <div className="max-w-6xl">
            <Content />
          </div>
        </div>
      </div>
    </div>
  )
}
