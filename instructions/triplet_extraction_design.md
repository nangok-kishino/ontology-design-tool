# トリプレット抽出機能 設計書

オントロジー設計支援ツール（Graph Navi）の次ステップ。**定義済みリレーション**と**本登録インスタンス**を使い、
既存文書から `(主語)—[述語]→(目的語)` のトリプレットを抽出し、**Neo4j へエクスポート**する。

- 作成日: 2026-07-27
- 確定事項:
  - **取込みエンジンは共通の1機能**。1回のアップロード＋解析で、オントロジー候補（クラス/リレーション/インスタンス）と
    トリプレット候補を**両方**抽出して保存する。メニュー（オントロジー設計 / ナレッジグラフ作成）は
    **保存済み結果のビュー切替**であり、概念は混ざらない。
  - トリプレットの「解決」（表層→本登録インスタンス紐付け・クラスペア整合・判定）は **LLM不要のサーバ処理**。
    インスタンスを本登録するたびに再解決で自動的に埋まる。
  - Neo4j への反映方式は **エクスポートのみ**（Cypher / CSV 生成。アプリからの直接 Bolt 登録は将来オプション）
  - グラフモデルは **インスタンス = ノード / トリプレット = エッジ**
  - トリプレット一覧は **本登録トリプレットのみ**を表示。手動追加・Neo4jエクスポートは一覧画面から**モーダル**で行う

---

## 1. トリプレットの定義

```
(主語インスタンス) —[述語リレーション]→ (目的語インスタンス)
```

| 要素 | 実体 | 制約 |
|------|------|------|
| 主語 S | `OntologyInstance`（**confirmed のみ**） | クラス Cs を持つ |
| 述語 P | `OntologyRelation` | `classPairs` を持つ |
| 目的語 O | `OntologyInstance`（**confirmed のみ**） | クラス Co を持つ |

**型整合の核心**: `(Cs, Co)` が P の `classPairs` のいずれかに一致して初めて正当なトリプレット。
既存オントロジー定義を「事実の検算」に転用できる。

---

## 2. アーキテクチャ（共通取込みエンジン ＋ 2ビュー）

### 2-1. 共通取込みエンジン
1回のアップロード＋「解析」で、共通エンジンが以下を行う：
- 文書 → テキスト抽出（既存 `analyze` の pdf-parse / text 流用）
- LLM 抽出（ツールコール）で **2種類**を取得し保存：
  - **オントロジー候補**（クラス / リレーション / インスタンス候補）← 既存 `analyze` 相当
  - **トリプレット生candidate**（表層文字列 ＋ 述語 ＋ 根拠スニペット）
- 文書単位で保存（取込みセッション）。以後この結果を2つのビューが参照する。

> 実装メモ：オントロジー抽出（クラス粒度へ一般化）とトリプレット抽出（インスタンス粒度の具体事実）は
> 狙いが逆なので、**1回の「解析」の中で専用の LLM 呼び出しを2本**走らせて品質を保つ（プロンプトを混ぜない）。
> ユーザーから見れば操作は「アップロード1回・解析1回」。

### 2-2. トリプレットの解決は LLM 不要
LLM の役割は「文書からトリプレットの**表層**と根拠を拾う」ところまで。
そこから先の —

- 表層文字列 → **本登録インスタンスの id に紐付け**
- **クラスペア整合**チェック（正当 / 型矛盾）
- 未登録なら「未解決」

— はすべて**サーバ側の照合処理（LLM不要）**。したがって：

1. 初回解析でトリプレット生candidate（表層＋根拠）を保存
2. オントロジー設計側でインスタンスを本登録していく
3. トリプレット側ビューは保存済み生candidateを**その都度サーバで再解決**するだけ（LLM再実行なし）。
   インスタンスが本登録されるたびに `未解決 → 正当/型矛盾` へ自動で埋まる

これにより「オントロジー抽出とトリプレット抽出を一緒に走らせても、抽出→登録の順序による取りこぼしが実害にならない」。

---

## 3. UI / IA

### サイドバー
```
全体
  ダッシュボード
オントロジー設計
  クラス管理
  リレーション管理
  文書取込み（オントロジー候補ビュー）   ← 既存 review-screen
インスタンス管理
  登録済みインスタンス
ナレッジグラフ作成
  トリプレット一覧                      ← メイン
  文書取込み（トリプレット候補ビュー）    ← review-screen と同じ作法
  グラフビュー（任意）
```
- 「文書取込み」は裏側が共通の1機能。2箇所のメニューは**表示する結果ビューが違うだけ**（文脈ラベルで区別）。

### トリプレット一覧（メイン）
- **本登録トリプレットのみ**のテーブル（クラス管理・ダッシュボードと同じ作法。仮・矛盾は出さない）
- TopBar 右に `Neo4jエクスポート`（outline）と `＋追加`（primary）。どちらも**モーダル**で開く
- 行クリックで編集モーダル
- `＋追加`モーダル＝ base-ui Dialog 作法。主語/述語/目的語の3セレクト（本登録インスタンス・定義済みリレーションのみ候補）
  ＋**クラスペア整合チェック**。型矛盾時は追加ボタン無効

### 文書取込み（トリプレット候補ビュー）
- 既存 review-screen を踏襲：モデル選択ヘッダー → 「ファイル指定」カード（破線D&D＋グラデ「LLMで解析する」）
  → 「解析結果」カード（採用チェック＋`正当な候補を本登録（N件）`緑ボタン＋テーブル）
- テーブル：採用チェック / 主語—述語→目的語 / 判定バッジ（正当・型矛盾・未解決）/ 抽出根拠スニペット
- 承認＝本登録トリプレット化 → 一覧に載る

### グラフビュー（任意・F4以降）
- 本登録トリプレットのノードリンク図。クラス色分け・ノードクリックで隣接強調。Neo4j投入前の俯瞰用。

### ダッシュボード（一貫性の追加提案）
- 右上に `＋クラス追加 / ＋リレーション追加 / ＋インスタンス追加` を置き、各画面の追加モーダルを開く（一覧の`＋追加`と作法統一）。

---

## 4. データモデル（Cosmos）

`lib/types.ts` に追加。

```ts
// 文書から抽出したトリプレットの生candidate（表層のまま保存。再解決の元データ）
export type TripletCandidate = {
  id: string
  projectId: string
  sourceDocName: string
  subjectText: string        // 文書中の主語表層
  predicateText: string      // 文書中の述語表層
  objectText: string         // 文書中の目的語表層
  evidence: string           // 抽出根拠スニペット
  confidence?: number
  createdBy: string; createdAt: string
  // 直近の再解決スナップショット（表示高速化用・任意）。判定は都度サーバで再計算してよい
  resolvedStatus?: "valid" | "type_conflict" | "unresolved"
}

// 承認済み（本登録）トリプレット。一覧・エクスポートの対象
export type Triplet = {
  id: string
  projectId: string
  subjectInstanceId: string
  predicateRelationId: string
  objectInstanceId: string
  // 表示・エクスポート安定用スナップショット
  subjectName: string;  subjectClassId: string | null
  predicateName: string
  objectName: string;   objectClassId: string | null
  sourceDocName?: string
  evidence?: string
  sourceCandidateId?: string // 由来の TripletCandidate（手動追加なら未設定）
  approvedBy: string; approvedAt: string
  neo4jSynced?: boolean; neo4jSyncedAt?: string
  createdBy: string; createdAt: string; updatedBy: string; updatedAt: string
}
```

コンテナ：`tripletCandidates`（生candidate）／`triplets`（本登録）。`getContainer()` の createIfNotExists で自動作成、PK `/id`。

---

## 5. バリデーション / 再解決（サーバ側・LLM不要）

`lib/triplet-resolve.ts`：`TripletCandidate` ＋ 現在の本登録インスタンス・定義済みリレーションから判定を算出。

- 主語・目的語の表層 → 本登録インスタンスへ解決（`normalizedName` 一致 → 名寄せ辞書 → 完全一致の順）
- 述語表層 → 定義済みリレーションへ解決
- `(Cs, Co)` が P.`classPairs` に含まれるか（F1は完全一致。将来 `parentId` 継承フラグ）
- 結果：`valid` / `type_conflict` / `unresolved`（＋重複検出）
- トリプレット一覧・レビューを開くたびに再計算 → インスタンス本登録の進捗が自動反映

---

## 6. 承認フロー

名寄せの原則を継承 — **自動確定なし・人の承認が単一の出口**（[[name-resolution-design]]）。
承認で `TripletCandidate` → `Triplet`（本登録、`approvedBy/At` 付与）。以後 Neo4j エクスポート対象。

---

## 7. Neo4j へのマッピング（エクスポートのみ）

```
本登録インスタンス → ノード      :Instance かつ :`クラス名`（ラベル）, { id, name, classId, className, ...属性 }
本登録トリプレット → リレーション  [:`述語名` { id, sourceDoc, approvedBy, approvedAt }]
```
- 冪等化：`MERGE (n:Instance {id})` / `MERGE (s)-[r {id: tripletId}]->(o)`
- 動的ラベル・型は文字列組み立て（DB由来の統制語彙。バッククォートをエスケープ）。日本語ラベルは `` :`含む` ``
- 出力：**Cypher スクリプト**（Aura Browser / cypher-shell へ貼付）／**CSV**（`LOAD CSV`）。いずれも一覧画面のエクスポートモーダルから
- 運用注意：Aura Free は無操作で一時停止・長期無操作で削除 → 定期再エクスポート／再開手順を運用に

---

## 8. ロードマップ

| フェーズ | 内容 |
|----------|------|
| **F1** | `Triplet` 型 + `triplets` コンテナ + 一覧画面（本登録のみ）+ `＋追加`モーダル（classPair検証）+ `lib/triplet-resolve.ts` |
| **F2** | 共通取込みエンジンにトリプレット抽出を追加（解析1回で生candidate保存）+ `tripletCandidates` + トリプレット候補ビュー（review-screen踏襲）+ 承認＝本登録 |
| **F3** | Neo4j エクスポートモーダル（Cypher / CSV） |
| **F4** | グラフビュー（任意）・サブクラス整合・差分/再エクスポート |
| （将来） | Bolt 直接登録（`neo4j-driver`）。今回スコープ外 |

---

## 9. 追加・変更ファイル（見取り図）

| ファイル | 変更 |
|----------|------|
| `lib/types.ts` | `Triplet` / `TripletCandidate` 追加 |
| `lib/triplet-resolve.ts` | 表層→本登録インスタンス解決・クラスペア整合・判定（LLM不要） |
| `lib/ingest.ts`（新 or `analyze` 拡張） | 共通取込み：オントロジー抽出＋トリプレット抽出を1解析で実行・保存 |
| `app/api/triplets/route.ts` / `[id]/route.ts` | 一覧・作成（classPair検証）・承認・編集・削除 |
| `app/api/triplet-candidates/route.ts` | 生candidateの取得＋再解決結果の付与 |
| `app/api/graph/export/route.ts` / `lib/graph-export.ts` | Cypher / CSV 生成（F3） |
| `components/triplets-screen.tsx` | 一覧＋`＋追加`モーダル＋エクスポートモーダル |
| `components/triplet-review-screen.tsx` | 文書取込み（トリプレット候補ビュー） |
| `components/graph-view-screen.tsx` | グラフビュー（F4・任意） |
| `components/sidebar.tsx` | `ナレッジグラフ作成` グループ追加 |

依存追加なし（`pdf-parse`・LLM SDK は既存流用。Bolt直接登録を将来やる場合のみ `neo4j-driver`）。

UI/UX モックアップ（本設計の前提を反映）: `scratchpad/triplet-mockup.html`（Artifact 公開済み）。
```
