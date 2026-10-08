import { queryOptions } from '@tanstack/react-query';

import { fetchOrgUnitDetailQuery } from './fetcher';

export const ORG_UNIT_DETAIL_QUERY_KEY = 'ORG_UNIT_DETAIL_QUERY_KEY';

export const getOrgUnitDetailQueryOptions = (unitId: string) =>
  queryOptions({
    queryKey: [ORG_UNIT_DETAIL_QUERY_KEY, unitId] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchOrgUnitDetailQuery({ params: { unitId: queryKey[1] }, signal }),
  });
