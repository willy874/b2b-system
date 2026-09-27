import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { FileListRoute } from '../../routes';
import type { FileSearchQuery } from '../../routes';

/** 篩選、第幾頁、LightBox 開著的檔案放在網址（可分享、上一頁可還原）。 */
export function useFileSearch() {
  const search = FileListRoute.useSearch();
  const navigate = useNavigate();

  const patch = useCallback(
    (next: Partial<FileSearchQuery>, options: { replace?: boolean } = {}) => {
      void navigate({
        to: FileListRoute.to,
        search: { ...search, ...next },
        replace: options.replace,
      });
    },
    [navigate, search],
  );

  return {
    search,
    /** 改篩選就回到第一頁；打字搜尋用 replace，不讓每個字都留一筆瀏覽紀錄。 */
    setFilters: (filters: Pick<FileSearchQuery, 'keyword' | 'category'>, replace = false) =>
      patch({ ...filters, offset: 0 }, { replace }),
    setOffset: (offset: number) => patch({ offset }),
    openPreview: (fileId: string) => patch({ preview: fileId }),
    /** 在 LightBox 裡切換上一個／下一個不留瀏覽紀錄：返回鍵直接關掉 LightBox。 */
    switchPreview: (fileId: string) => patch({ preview: fileId }, { replace: true }),
    closePreview: () => patch({ preview: undefined }),
  };
}
