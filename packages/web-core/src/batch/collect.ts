/**
 * 「選取全部符合的 N 筆」的收集（docs/architecture/frontend/07-ui-system.md §13.7）：以列表頁自己的 API、
 * 同樣的篩選與排序逐頁取回，展開成明確的清單再交給佇列。沒有後端的依條件批次端點。
 */

/** 一次最多收集幾筆：與後端的 offset 上限（`MAX_OFFSET`）相同，超過時不提供「選取全部」。 */
export const BATCH_SELECT_ALL_MAX = 10_000;

/** 收集時每頁取幾筆（列表 API 的 `limit` 上限）。 */
export const BATCH_COLLECT_PAGE_SIZE = 200;

/** 列表頁提供的取頁函式：同一個列表 API、目前的篩選與排序，只換 offset／limit。 */
export type BatchPageFetcher<TData> = (
  offset: number,
  limit: number,
  signal: AbortSignal,
) => Promise<{ items: readonly TData[]; total: number }>;

export interface CollectAllOptions<TData> {
  fetchPage: BatchPageFetcher<TData>;
  signal: AbortSignal;
  /** 每取回一頁回報已收集的筆數與目前的總數。 */
  onProgress?: (collected: number, total: number) => void;
  /** 預設 `BATCH_SELECT_ALL_MAX`。 */
  max?: number;
  /** 預設 `BATCH_COLLECT_PAGE_SIZE`。 */
  pageSize?: number;
}

/**
 * 逐頁取回到最後一頁（或 `max` 筆）。收集期間被刪除或新增的列會讓頁面錯位一兩筆：
 * 語意是確認當下的快照，之後已不存在的項目由單筆 API 回 404，照佇列既有的方式列進失敗清單。
 * `signal` 中止時拋出它的 reason（呼叫端不送出任何請求）。
 */
export async function collectAllPages<TData>({
  fetchPage,
  signal,
  onProgress,
  max = BATCH_SELECT_ALL_MAX,
  pageSize = BATCH_COLLECT_PAGE_SIZE,
}: CollectAllOptions<TData>): Promise<TData[]> {
  const collected: TData[] = [];
  let total = Number.POSITIVE_INFINITY;
  while (collected.length < Math.min(total, max)) {
    signal.throwIfAborted();
    const limit = Math.min(pageSize, max - collected.length);
    // oxlint-disable-next-line no-await-in-loop -- 依序取頁：下一頁的 offset 取決於這一頁
    const page = await fetchPage(collected.length, limit, signal);
    signal.throwIfAborted();
    total = page.total;
    collected.push(...page.items);
    onProgress?.(Math.min(collected.length, max), Math.min(total, max));
    // 這一頁不滿（資料在收集期間變少）就是最後一頁
    if (page.items.length < limit) break;
  }
  return collected.slice(0, max);
}
