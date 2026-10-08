import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getOrgUnitControllerUpdateUrl } from '@/shared/api-sdk';
import type { OrgUnitDetail, UpdateOrgUnitRequest } from '@/shared/api-sdk';

export const fetchOrgUnitUpdateMutation = defineAuthFetcher<
  HttpRequestDTO<{ unitId: string; body: UpdateOrgUnitRequest }>,
  OrgUnitDetail
>((http, request) =>
  http.request(
    getOrgUnitControllerUpdateUrl({ id: request.params.unitId }),
    jsonBody(request.params.body, { method: 'PATCH' }),
  ),
);
