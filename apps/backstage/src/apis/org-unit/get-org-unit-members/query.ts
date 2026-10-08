import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import type { OrgUnitMemberListParams } from '../types';
import { fetchOrgUnitMembersQuery } from './fetcher';

export const ORG_UNIT_MEMBERS_QUERY_KEY = 'ORG_UNIT_MEMBERS_QUERY_KEY';

export const getOrgUnitMembersQueryOptions = (params: OrgUnitMemberListParams) =>
  queryOptions({
    queryKey: [
      ORG_UNIT_MEMBERS_QUERY_KEY,
      params.unitId,
      params.offset,
      params.limit,
      params.includeDescendants ?? false,
      params.keyword ?? '',
    ] as const,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => fetchOrgUnitMembersQuery({ params, signal }),
  });
