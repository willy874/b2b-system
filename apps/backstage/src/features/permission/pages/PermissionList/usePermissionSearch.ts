import { useRouteSearch } from '@b2b-system/web-core/router';

import { PermissionListRoute } from '../../routes';
import type { PermissionFilters, PermissionSearchQuery, PermissionView } from '../../routes';

/** 檢視方式、篩選與樹狀圖選取的權限放在網址（可分享、上一頁可還原）。 */
export function usePermissionSearch() {
  const { search, patch } = useRouteSearch<PermissionSearchQuery>(PermissionListRoute);

  return {
    search,
    setView: (view: PermissionView) => patch({ view }),
    /** 打字搜尋用 replace，不讓每個字都留一筆瀏覽紀錄。 */
    setFilters: (filters: PermissionFilters, replace = false) => patch(filters, { replace }),
    resetFilters: () => patch({ keyword: undefined, resource: undefined, held: undefined }),
    /** 在樹狀圖上點來點去不留瀏覽紀錄：上一頁回到切換檢視之前。 */
    selectKey: (key: string | undefined) => patch({ key }, { replace: true }),
    /** 從列表跳到樹狀圖上的某個權限。 */
    showInTree: (key: string) => patch({ view: 'tree', key }),
  };
}
