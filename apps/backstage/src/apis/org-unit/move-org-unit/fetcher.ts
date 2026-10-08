import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getOrgUnitControllerMoveUrl } from '@/shared/api-sdk';
import type { MoveOrgUnitRequest, OrgUnitDetail } from '@/shared/api-sdk';

export const fetchOrgUnitMoveMutation = defineAuthFetcher<
  HttpRequestDTO<{ unitId: string; body: MoveOrgUnitRequest }>,
  OrgUnitDetail
>((http, request) =>
  http.request(
    getOrgUnitControllerMoveUrl({ id: request.params.unitId }),
    jsonBody(request.params.body, { method: 'POST' }),
  ),
);
