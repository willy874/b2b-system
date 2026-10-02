import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { AnnouncementListRoute } from '../../routes';
import type { AnnouncementSearchQuery } from '../../routes';

/** 列表的分頁、關鍵字與狀態全部放在網址；改條件就回到第一頁。 */
export function useAnnouncementSearchFilter() {
  const search = AnnouncementListRoute.useSearch();
  const navigate = useNavigate({ from: AnnouncementListRoute.fullPath });

  const patch = useCallback(
    (next: Partial<AnnouncementSearchQuery>) => {
      void navigate({ to: AnnouncementListRoute.to, search: { ...search, ...next } });
    },
    [navigate, search],
  );

  return {
    search,
    setKeyword: (keyword: string | undefined) =>
      patch({ keyword: keyword || undefined, offset: 0 }),
    setStatus: (status: AnnouncementSearchQuery['status']) => patch({ status, offset: 0 }),
    setPage: (offset: number, limit: number) => patch({ offset, limit }),
  };
}
