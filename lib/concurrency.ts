// 複数のHTTPリクエストを同時実行数を制限して走らせる。
//
// 一括本登録のように「同じ処理を件数分くりかえす」操作を直列で回すと、
// 件数×1往復ぶんの待ち時間がそのまま体感になる。ここで数本ずつ束ねて流す。
//
// 注意: 並列化してよいのは、互いに結果へ影響しないジョブだけ。
// サーバ側の重複チェック（同一クラス×正規化一致、クラス同義語の衝突）は
// 「先に登録されたもの」を見て弾くため、衝突しうるジョブは呼び出し側で
// 1つのジョブにまとめて直列に実行すること。
export async function runWithConcurrency(jobs: (() => Promise<void>)[], limit = 5): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    while (true) {
      const index = next++
      if (index >= jobs.length) return
      await jobs[index]()
    }
  })
  await Promise.all(workers)
}

// キーが同じ要素をまとめた配列の配列を返す（挿入順は保たれる）
export function groupBy<T>(items: T[], keyOf: (item: T) => string): T[][] {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    const bucket = map.get(key)
    if (bucket) bucket.push(item)
    else map.set(key, [item])
  }
  return [...map.values()]
}
