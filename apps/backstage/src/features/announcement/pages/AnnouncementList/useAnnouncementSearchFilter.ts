import { useRouteSearch } from '@b2b-system/web-core/router';

import { AnnouncementListRoute } from '../../routes';
import type { AnnouncementSearchQuery } from '../../routes';

/** 列表的分頁、關鍵字與狀態全部放在網址；改條件就回到第一頁。 */
export function useAnnouncementSearchFilter() {
  const { search, patch } = useRouteSearch<AnnouncementSearchQuery>(AnnouncementListRoute);

  return {
    search,
    setKeyword: (keyword: string | undefined) =>
      patch({ keyword: keyword || undefined, offset: 0 }),
    setStatus: (status: AnnouncementSearchQuery['status']) => patch({ status, offset: 0 }),
    setPage: (offset: number, limit: number) => patch({ offset, limit }),
  };
}
