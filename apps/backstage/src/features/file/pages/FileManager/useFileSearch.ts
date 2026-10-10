import { useRouteSearch } from '@b2b-system/web-core/router';

import { FileListRoute } from '../../routes';
import type { FileSearchQuery } from '../../routes';

/** 所在的資料夾、篩選、第幾頁、LightBox 開著的檔案放在網址（可分享、上一頁可還原）。 */
export function useFileSearch() {
  const { search, patch } = useRouteSearch<FileSearchQuery>(FileListRoute);

  return {
    search,
    /** 改篩選就回到第一頁；打字搜尋用 replace，不讓每個字都留一筆瀏覽紀錄。 */
    setFilters: (filters: Pick<FileSearchQuery, 'keyword' | 'category' | 'tag'>, replace = false) =>
      patch({ ...filters, offset: 0 }, { replace }),
    setOffset: (offset: number) => patch({ offset }),
    /**
     * 進入資料夾（undefined 是根目錄）：回到第一頁、清掉搜尋與預覽——上一層的搜尋字放進新的資料夾沒有意義。
     * 每次進入都留瀏覽紀錄，上一頁回到上一個資料夾；資料夾已不存在時以 `replace` 退回。
     */
    setFolder: (folder: string | undefined, options: { replace?: boolean } = {}) =>
      patch({ folder, offset: 0, keyword: undefined, preview: undefined }, options),
    openPreview: (fileId: string) => patch({ preview: fileId }),
    /** 在 LightBox 裡切換上一個／下一個不留瀏覽紀錄：返回鍵直接關掉 LightBox。 */
    switchPreview: (fileId: string) => patch({ preview: fileId }, { replace: true }),
    closePreview: () => patch({ preview: undefined }),
    /** 從審批詳情帶來的申請關閉後拿掉參數；不留瀏覽紀錄，上一頁回到審批詳情。 */
    clearRequestAccess: () =>
      patch({ requestAccess: undefined, resubmit: undefined }, { replace: true }),
  };
}
