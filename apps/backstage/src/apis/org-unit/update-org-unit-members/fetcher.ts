import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getOrgUnitControllerUpdateMembersUrl } from '@/shared/api-sdk';
import type { OrgUnitDetail, UpdateOrgUnitMembersRequest } from '@/shared/api-sdk';

export const fetchOrgUnitMembersUpdateMutation = defineAuthFetcher<
  HttpRequestDTO<{ unitId: string; body: UpdateOrgUnitMembersRequest }>,
  OrgUnitDetail
>((http, request) =>
  http.request(
    getOrgUnitControllerUpdateMembersUrl({ id: request.params.unitId }),
    jsonBody(request.params.body, { method: 'PATCH' }),
  ),
);
