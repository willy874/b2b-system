import { useCallback, useState } from 'react';

interface PageCursors {
  /** 篩選條件與每頁筆數：任一改變，記下的游標都作廢。 */
  scope: string;
  /** offset → 取那一頁用的游標（前一頁回應的 `nextCursor`）。 */
  byOffset: Record<number, string>;
}

/**
 * 依序翻頁時改用游標（docs/architecture/backend/06-audit-log.md §7）：載入第 N 頁後記下它的 `nextCursor`，
 * 之後到第 N + 1 頁就以游標取，每頁只讀一頁、不必先掃過 offset 筆，翻頁途中寫入的新紀錄也不會讓下一頁重複。
 * 跳頁、重新整理、從網址進來的頁沒有游標，照舊以 offset 取。
 */
export function useAuditLogCursor(scope: string, offset: number, limit: number) {
  const [cursors, setCursors] = useState<PageCursors>({ scope, byOffset: {} });
  const cursor = cursors.scope === scope ? cursors.byOffset[offset] : undefined;

  /** 這一頁載入完成：記下下一頁的游標（沒有下一頁時是 `null`）。 */
  const remember = useCallback(
    (pageOffset: number, nextCursor: string | null | undefined) => {
      if (!nextCursor) return;
      setCursors((prev) => {
        const byOffset = prev.scope === scope ? prev.byOffset : {};
        if (byOffset[pageOffset + limit] === nextCursor) return prev;
        return { scope, byOffset: { ...byOffset, [pageOffset + limit]: nextCursor } };
      });
    },
    [scope, limit],
  );

  return { cursor, remember };
}
