/** 一頁的回應形狀（`{ items, pagination }`，與 api 的列表端點相同）。 */
export interface PagedResult<T> {
  items: T[];
  pagination: { total: number };
}

export interface FetchAllPagesOptions {
  /** 一次取幾筆；api 分頁的上限是 200（`apps/api/src/core/http/pagination.ts`） */
  pageSize?: number;
  /** 最多取幾筆，避免資料異常時無止盡地請求 */
  maxItems?: number;
}

/**
 * 依序取完所有分頁，給在本地過濾的選擇器用（角色、群組的選項）。
 * 只取第一頁會讓排在後面的項目選不到、畫面也沒有任何跡象（docs/architecture/frontend/07-ui-system.md §6.1）。
 * 回傳的形狀與一頁相同，呼叫端照舊讀 `items`。
 */
export async function fetchAllPages<T>(
  fetchPage: (offset: number, limit: number) => Promise<PagedResult<T>>,
  { pageSize = 200, maxItems = 5000 }: FetchAllPagesOptions = {},
): Promise<{ items: T[]; pagination: { offset: number; limit: number; total: number } }> {
  const items: T[] = [];
  let total = 0;
  do {
    // 下一頁的 offset 與要不要繼續都取決於這一頁的結果，只能依序取
    // oxlint-disable-next-line no-await-in-loop
    const page = await fetchPage(items.length, pageSize);
    items.push(...page.items);
    total = page.pagination.total;
    // 頁面比預期短（同時有人刪除）就停，不要以同一個 offset 重複請求
    if (page.items.length < pageSize) break;
  } while (items.length < total && items.length < maxItems);
  return { items, pagination: { offset: 0, limit: items.length, total } };
}
