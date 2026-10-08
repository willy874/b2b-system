import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getOrgUnitControllerFindOneUrl } from '@/shared/api-sdk';
import type { OrgUnitDetail } from '@/shared/api-sdk';

export const fetchOrgUnitDetailQuery = defineAuthFetcher<
  HttpRequestDTO<{ unitId: string }>,
  OrgUnitDetail
>((http, request) =>
  http.request(getOrgUnitControllerFindOneUrl({ id: request.params.unitId }), { method: 'GET' }),
);
