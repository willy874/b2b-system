import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getOrgUnitControllerRestoreUrl } from '@/shared/api-sdk';
import type { OrgUnitDetail } from '@/shared/api-sdk';

export const fetchOrgUnitRestoreMutation = defineAuthFetcher<
  HttpRequestDTO<{ unitId: string }>,
  OrgUnitDetail
>((http, request) =>
  http.request(getOrgUnitControllerRestoreUrl({ id: request.params.unitId }), { method: 'POST' }),
);
