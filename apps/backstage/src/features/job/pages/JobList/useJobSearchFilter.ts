import type { JobView } from '@b2b-system/web-core/job';
import { useRouteSearch } from '@b2b-system/web-core/router';

import { JobListRoute } from '../../routes';
import type { JobSearchQuery } from '../../routes';

/** 分頁（工作列表／佇列概況）、列表的分頁與篩選全部放在網址；改篩選條件時回到第一頁。 */
export function useJobSearchFilter() {
  const { search, patch } = useRouteSearch<JobSearchQuery>(JobListRoute);

  return {
    search,
    setFilter: (filter: Partial<Omit<JobSearchQuery, 'offset' | 'limit' | 'view'>>) =>
      patch({ ...filter, offset: 0 }),
    setPage: (offset: number, limit: number) => patch({ offset, limit }),
    setView: (view: JobView) => patch({ view }),
  };
}
