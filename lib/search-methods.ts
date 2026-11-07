// 知見の検索について。画面「知見の検索について」の各ページの表が読む。
//
// 情報の持ち方（インデックス・ベクトル・グラフ）と、それを使う検索手段（従来型インデックス検索・RAG・グラフ＋RAG）の整理。
// グラフにする知見を絞る基準は、LLM による解析と共有しているため lib/knowledge-scope.ts に置く。
// 並び順は、どの表も「インデックス → ベクトル → グラフ」「従来型インデックス検索 → RAG → グラフ＋RAG」にそろえる。

export type StorageForm = "インデックス" | "ベクトル" | "グラフ"

export type SearchMethod = "従来型インデックス検索" | "RAG" | "グラフ＋RAG"

// １．情報の持ち方の違い

export type StorageFormRow = {
  form: StorageForm
  unit: string
  matching: string
  goodAt: string
  badAt: string
}

export const STORAGE_FORMS: StorageFormRow[] = [
  {
    form: "インデックス",
    unit: "文書に含まれる語、および文書に付与した属性（番号、日付、状態、分類など）の値",
    matching: "検索語や条件と一致するかどうか",
    goodAt: "番号・語・条件による、確実で漏れのない抽出",
    badAt: "表現が異なる同じ内容は見つからない。文書どうしの関係は扱えない",
  },
  {
    form: "ベクトル",
    unit: "文書を分割した文章の断片（チャンク）。各断片の意味を数値の並びに変換して持つ",
    matching: "問いとの意味の近さで順位を付け、上位の断片を返す",
    goodAt: "表現が異なる類似の内容や、文脈を含む文章の取得",
    badAt: "一致の確定的な判定。上位のみを返すため、網羅的な列挙。文書をまたぐ関係",
  },
  {
    form: "グラフ",
    unit: "要素（部品、現象、原因、対策など）と、要素間の関係（発生、原因、対策など）",
    matching: "指定した要素と関係の条件に合うつながりをたどって照合する",
    goodAt: "可否の確定的な判定。複数段の関係の追跡。網羅的な列挙",
    badAt: "文脈や程度表現など、要素に分けると意味が失われる知見。登録されていない内容",
  },
]

// ２．既存知見からの情報の作り方

export type BuildMethodRow = {
  form: StorageForm
  steps: string
  byMachine: string
  byHuman: string
  whenGrowing: string
}

export const BUILD_METHODS: BuildMethodRow[] = [
  {
    form: "インデックス",
    steps: "本文に含まれる語から索引を作る。文書ごとに、番号・日付・状態・分類などの属性の値を入れる",
    byMachine: "本文の索引づくり。既存のシステムにある属性の値の取り込み",
    byHuman: "どの属性を持つか。値をどう表記するか（例：「異音」と「異常音」のどちらにそろえるか）",
    whenGrowing: "新しい文書は、自動で索引に加わる。属性の値は、文書ごとに入れる",
  },
  {
    form: "ベクトル",
    steps: "文書を断片に分け、各断片の意味を数値の並びに変換する",
    byMachine: "分割と変換のすべて",
    byHuman: "どの単位で分けるか（細かすぎると文脈が切れ、粗すぎると焦点がぼやける）",
    whenGrowing: "新しい文書を、分割・変換して加えるだけで済む",
  },
  {
    form: "グラフ",
    steps: "持つ要素と関係の種類を決め、文書から要素と関係を抜き出して登録する",
    byMachine: "抜き出す要素と関係の候補づくり（LLMで候補を出す）",
    byHuman: "要素と関係の種類をどう定めるか。抜き出した候補が正しいか",
    whenGrowing: "文書ごとに、抜き出しと確認が要る。これまでに無い種類の要素や関係が出てくれば、種類の定め方から見直す",
  },
]

// ３．情報の持ち方と検索手段の対応

export type SearchMechanismRow = {
  method: SearchMethod
  forms: StorageForm[]
  answer: string
  strengths: string
  weaknesses: string
}

export const SEARCH_MECHANISMS: SearchMechanismRow[] = [
  {
    method: "従来型インデックス検索",
    forms: ["インデックス"],
    answer: "検索語や条件に一致した文書やデータを、そのまま返す。回答の文章は作らない",
    strengths: "返るのは原文そのもので、書かれていない内容が混ざらない。同じ条件なら毎回同じ結果が返る。条件に一致するものは漏れなく返る",
    weaknesses: "答えは、利用者が文書を読んで見つける。複数の文書にまたがる内容を、まとめて答えることはできない。別の言い方で書かれた文書は見つからない",
  },
  {
    method: "RAG",
    forms: ["ベクトル"],
    answer: "問いと意味の近い文章の断片を上位からいくつか取り出し、それをもとにLLMが回答の文章を書く",
    strengths: "問いに直接答える文章が返る。表現が異なっていても、意味の近い内容を拾える。複数の断片の内容をまとめて答えられる",
    weaknesses: "上位の一部しか使わないため、網羅的な列挙はできない。意味の近さで選ぶため、条件の異なる似た事例を拾うことがある。LLMが文章を書くため、断片に書かれていない内容が混ざることがあり、同じ問いでも回答が毎回同じとは限らない",
  },
  {
    method: "グラフ＋RAG",
    forms: ["グラフ", "ベクトル"],
    answer: "問いに当たる要素と関係をグラフで照会して対象を特定し、そこからたどった原文もあわせて、LLMが回答の文章を書く",
    strengths: "何が該当するかはグラフの照会で決まり、意味の近さに左右されない。そのため、可否の判定や網羅的な列挙ができる。複数段の関係をたどり、文書をまたいだつながりを示せる",
    weaknesses: "グラフに登録した知見の範囲でしか答えられない。問いを、どの要素・関係の照会に置き換えるかを誤ると、誤った条件のまま確定的な答えが返る。回答の文章はLLMが書くため、その部分にはRAGと同じ注意が要る",
  },
]

// ３．の補足：「見つからなかった」ときの読み方

export type NotFoundReadingRow = {
  method: SearchMethod
  meaning: string
}

export const NOT_FOUND_READINGS: NotFoundReadingRow[] = [
  {
    method: "従来型インデックス検索",
    meaning: "その語や属性の値を持つ文書は無い、ということまでは言える。ただし、別の言い方で書かれた文書が無いとは言えない",
  },
  {
    method: "RAG",
    meaning: "取り出した上位の断片には含まれていなかった、ということしか言えない。文書に無いとは言えない。また、該当する内容が無くても近いものから順に断片が返るため、関係の薄い内容をもとに回答が書かれることがある",
  },
  {
    method: "グラフ＋RAG",
    meaning: "グラフには登録されていない（または、照会の条件が問いとずれていた）、ということしか言えない。グラフ化の対象外の知見や、まだ登録していない事実が無いとは言えない",
  },
]

// ４．問いの種類に対する最適な検索手段

export type SearchMethodRow = {
  method: SearchMethod
  question: string
  // 前の行と同じなら、画面では「同上」と出す
  prerequisite: string
  reason: string
  examples: string[]
}

const GRAPH_PREREQUISITE = "対象の知見がグラフ化され、要素と関係の種類がオントロジーで定義されていること"
const GRAPH_SOURCE_PREREQUISITE = `${GRAPH_PREREQUISITE}に加え、グラフの要素から根拠となる原文へたどれること`
const RAG_PREREQUISITE = "文書が適切な単位に分割され、ベクトル化されていること"

export const SEARCH_METHODS: SearchMethodRow[] = [
  {
    method: "従来型インデックス検索",
    question: "特定の語を含む文書を探す",
    prerequisite: "本文の全文インデックスが作成されていること",
    reason: "語が一致するかどうかで結果が決まる。該当する文書を漏れなく抽出できる",
    examples: [
      "『クリアランス不足』という語を含む設変通知を一覧にして",
    ],
  },
  {
    method: "従来型インデックス検索",
    question: "番号・名称・属性（日付、部門、状態、分類など）で、対象を特定する、または絞り込んで一覧を得る",
    prerequisite: "検索に使う属性（文書番号・部品番号などの識別子を含む）がデータベースに定義され、値が統一された表記で入力されていること",
    reason: "属性の値が一致するかどうかで結果が決まる。意味を解釈する必要がなく、対象を確実かつ漏れなく抽出できる",
    examples: [
      "部品番号12345の最新図面はどれか",
      "2024年以降に発行された、現象分類が『異音』のトラブル報告書を一覧にして",
    ],
  },
  {
    method: "RAG",
    question: "経緯や判断の理由を探す",
    prerequisite: RAG_PREREQUISITE,
    reason: "答えが文書中の文脈の連なりにあり、文章の意味をもとに該当箇所を探す必要がある",
    examples: [
      "振動試験で共振が出た際、どのような条件を確認して対策を決めたか",
      "温度サイクル試験で割れが出た事例では、なぜ材料変更ではなく形状変更を選んだか",
    ],
  },
  {
    method: "RAG",
    question: "言い回しが一定しない類似事例やノウハウを探す",
    prerequisite: RAG_PREREQUISITE,
    reason: "書き手によって表現が異なるため、語の一致では見つからず、意味の近さで探す必要がある",
    examples: [
      "薄板の穴あけでバリを抑えるコツはあるか",
      "樹脂部品の反りを抑えた事例はあるか",
    ],
  },
  {
    method: "グラフ＋RAG",
    question: "可否・適合を判定する",
    prerequisite: GRAPH_PREREQUISITE,
    reason: "答えを確定的に返す必要があり、グラフに登録した制約を照会することで判定できる",
    examples: [
      "材料Aと組み合わせてはならない接着剤は何か",
      "板厚1.6mmの場合、バリ対策の数値条件を満たすか",
    ],
  },
  {
    method: "グラフ＋RAG",
    question: "関係を複数段たどる、文書を横断して関連を探す",
    prerequisite: GRAPH_SOURCE_PREREQUISITE,
    reason: "事象のつながりが複数の文書にまたがるため、グラフでたどり、根拠となる原文で補う",
    examples: [
      "クリアランス不足が原因となったトラブルは、ほかにどの部品で起きているか",
      "部品Aで異音が出た過去事例の原因と対策を、関連する報告書の要点とあわせて示して",
    ],
  },
  {
    method: "グラフ＋RAG",
    question: "影響範囲や網羅的な一覧を得る",
    prerequisite: GRAPH_SOURCE_PREREQUISITE,
    reason: "RAGは関連の高い一部の文書しか参照しないため、漏れなく列挙するには関係をたどる照会が適している",
    examples: [
      "部品Aを設変した場合、影響を受ける製品と過去の関連トラブルは何か",
      "仕向け地EUで使用できない部品をすべて挙げて",
    ],
  },
]
