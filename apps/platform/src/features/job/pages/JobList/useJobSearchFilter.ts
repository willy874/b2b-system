import type { JobView } from '@b2b-system/web-core/job';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { JobListRoute } from '../../routes';
import type { JobSearchQuery } from '../../routes';

export type JobFilter = Partial<Omit<JobSearchQuery, 'offset' | 'limit' | 'view'>>;

/** 分頁（工作列表／佇列概況）、列表的分頁與篩選全部放在網址；改篩選條件時回到第一頁。 */
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
    setFilter: (filter: JobFilter) => patch({ ...filter, offset: 0 }),
    setPage: (offset: number, limit: number) => patch({ offset, limit }),
    setView: (view: JobView) => patch({ view }),
  };
}
