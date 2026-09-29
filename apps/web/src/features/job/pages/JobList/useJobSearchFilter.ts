import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { JobListRoute } from '../../routes';
import type { JobSearchQuery } from '../../routes';

/** 列表的分頁與篩選全部放在網址；改篩選條件時回到第一頁。 */
export function useJobSearchFilter() {
  const search = JobListRoute.useSearch();
  const navigate = useNavigate();

  const patch = useCallback(
    (next: Partial<JobSearchQuery>) => {
      void navigate({ to: JobListRoute.to, search: { ...search, ...next } });
    },
    [navigate, search],
  );

  return {
    search,
    setFilter: (filter: Partial<Omit<JobSearchQuery, 'offset' | 'limit'>>) =>
      patch({ ...filter, offset: 0 }),
    setPage: (offset: number, limit: number) => patch({ offset, limit }),
  };
}
