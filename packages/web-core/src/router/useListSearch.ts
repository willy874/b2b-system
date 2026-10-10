import type { SortEntry } from '@b2b-system/web-shared/constants';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';

/** `createRoute` 的回傳值裡，這兩個 hook 用得到的部分。 */
export interface SearchRoute<TSearch> {
  /** route 的完整路徑（`Route.to`）。 */
  to: string;
  useSearch: () => TSearch;
}

export interface PatchSearchOptions {
  /** 不留瀏覽紀錄（例：打字搜尋、在樹狀圖上點選）。 */
  replace?: boolean;
}

/**
 * 把頁面狀態放在網址的 search：`patch(next)` 只改給的欄位，其他照舊。
 * 以函式形式的 search 合併：同一個事件裡連續呼叫兩次時，後一次不會蓋掉前一次（以 render 當下的 search 合併會）。
 */
export function useRouteSearch<TSearch extends object>(route: SearchRoute<TSearch>) {
  const search = route.useSearch();
  const navigate = useNavigate();
  const { to } = route;
  const patch = useCallback(
    (next: Partial<TSearch>, options: PatchSearchOptions = {}) => {
      void navigate({
        to,
        search: (prev: object) => ({ ...prev, ...next }),
        replace: options.replace,
      } as never);
    },
    [navigate, to],
  );
  return { search, patch };
}

/** 列表頁的網址條件：分頁，加上選用的關鍵字、排序與其他篩選。 */
export interface ListSearch {
  offset: number;
  limit: number;
  keyword?: string;
  sort?: ReadonlyArray<SortEntry<string>>;
}

/**
 * 列表頁的分頁、關鍵字、排序、篩選全部放在網址（兩個 app 的列表頁共用）。改篩選、關鍵字或排序就回到第一頁；
 * 換頁只改 `offset`／`limit`。feature 有額外的 setter 時以 `patch` 組成。
 */
export function useListSearch<TSearch extends ListSearch>(route: SearchRoute<TSearch>) {
  const { search, patch } = useRouteSearch(route);
  // 泛型實作的必要轉型：TSearch 至少有 ListSearch 的欄位，但 TypeScript 推不出 `{ offset }` 是 Partial<TSearch>
  return useMemo(
    () => ({
      search,
      patch,
      setPage: (offset: number, limit: number) => patch({ offset, limit } as Partial<TSearch>),
      /** 改關鍵字就回到第一頁；空字串等於不篩選。 */
      setKeyword: (keyword: string | undefined) =>
        patch({ keyword: keyword || undefined, offset: 0 } as Partial<TSearch>),
      /** 表頭點擊：整組多欄排序換成點擊後的結果，回到第一頁。 */
      setSort: (sort: TSearch['sort']) => patch({ sort, offset: 0 } as Partial<TSearch>),
      /** 篩選面板送出時一次更新，回到第一頁。 */
      setFilters: (filters: Partial<Omit<TSearch, 'offset' | 'limit'>>) =>
        patch({ ...filters, offset: 0 } as Partial<TSearch>),
    }),
    [patch, search],
  );
}
