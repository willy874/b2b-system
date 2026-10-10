/** 無限捲動的一頁（`GET /gallery/items` 的回應中這裡用得到的部分）。 */
export interface SnapshotPage<T> {
  items: readonly T[];
  nextCursor: string | null;
}

/** `useInfiniteQuery` 的 `data`：頁與頁參數一一對應，頁參數帶頁碼。 */
export interface SnapshotSource<T> {
  pages: readonly SnapshotPage<T>[];
  pageParams: readonly { index: number }[];
}

/** 快照的項目在保留的頁之前或之後：捲到它時往前或往後取一頁。 */
export type StaleSide = 'before' | 'after';

export interface MergedPages<T> {
  /** 依頁碼排好的所有項目：保留的頁是最新的資料，被丟掉的頁是最後一次取到的快照。 */
  items: T[];
  /** 來自快照的項目 → 在保留的頁之前或之後。 */
  stale: ReadonlyMap<string, StaleSide>;
}

/**
 * 無限捲動被 `maxPages` 丟掉的頁的快照（docs/architecture/frontend/24-gallery.md §3）。
 * 圖片庫是等高排列（列高依每張圖的比例而定），丟掉的頁沒辦法以等高的佔位保留捲動位置；
 * 改成保留最後一次取到的資料，版面、選取、檢視器的上一張下一張都照舊，捲到快照時再重新取那一頁。
 * 重新驗證（推播、回到分頁）只重抓保留的頁。
 *
 * 以 `useState(createPageSnapshots)` 建立、在 `useMemo` 裡呼叫 `merge`（同 `JustifiedGrid` 的版面快取）。
 * `key` 是查詢條件：換了條件就清空。
 */
export function createPageSnapshots<T extends { id: string }>() {
  let currentKey: string | undefined;
  const pages = new Map<number, readonly T[]>();

  return {
    merge(key: string, data: SnapshotSource<T> | undefined): MergedPages<T> {
      if (key !== currentKey) {
        pages.clear();
        currentKey = key;
      }
      if (!data?.pages.length) return { items: [], stale: new Map() };

      const live = new Set<number>();
      data.pages.forEach((page, position) => {
        const index = data.pageParams[position]?.index ?? position;
        live.add(index);
        pages.set(index, page.items);
      });
      const firstLive = Math.min(...live);
      const lastLive = Math.max(...live);
      // 保留的最後一頁已經是最後一頁（例：別人刪掉了圖片）：之後的快照不再存在
      if (data.pages.at(-1)?.nextCursor === null) {
        for (const index of pages.keys()) if (index > lastLive) pages.delete(index);
      }

      const liveIds = new Set<string>();
      for (const index of live) for (const item of pages.get(index) ?? []) liveIds.add(item.id);

      const items: T[] = [];
      const stale = new Map<string, StaleSide>();
      const seen = new Set<string>();
      for (const index of [...pages.keys()].toSorted((a, b) => a - b)) {
        const isLive = live.has(index);
        for (const item of pages.get(index) ?? []) {
          // 快照與保留的頁重疊（取回來之後前後的內容變了）時以保留的頁為準
          if (seen.has(item.id) || (!isLive && liveIds.has(item.id))) continue;
          seen.add(item.id);
          items.push(item);
          if (!isLive) stale.set(item.id, index < firstLive ? 'before' : 'after');
        }
      }
      return { items, stale };
    },
  };
}
