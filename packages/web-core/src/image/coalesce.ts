/**
 * 把同一個微任務內的多次呼叫合併成一次（docs/architecture/backend/25-image.md §5 D7）：一頁 50 個頭像的網址同時過期時，
 * 擁有它們的查詢只失效一次，而不是重抓 50 次。
 *
 * ```ts
 * const onExpired = useMemo(() => coalesce(() => invalidateResources([...])), []);
 * ```
 */
export function coalesce(fn: () => void): () => void {
  let isScheduled = false;
  return () => {
    if (isScheduled) return;
    isScheduled = true;
    queueMicrotask(() => {
      isScheduled = false;
      fn();
    });
  };
}
