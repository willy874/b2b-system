import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getOrgUnitControllerListMembersUrl } from '@/shared/api-sdk';
import type { OrgUnitControllerListMembersResponse } from '@/shared/api-sdk';

import type { OrgUnitMemberListParams } from '../types';

export const fetchOrgUnitMembersQuery = defineAuthFetcher<
  HttpRequestDTO<OrgUnitMemberListParams>,
  OrgUnitControllerListMembersResponse['data']
>((http, request) => {
  const { unitId, includeDescendants, ...query } = request.params;
  return http.request(
    withQuery(getOrgUnitControllerListMembersUrl({ id: unitId }), {
      ...query,
      includeDescendants: includeDescendants ? 'true' : undefined,
    }),
    { method: 'GET' },
  );
});
