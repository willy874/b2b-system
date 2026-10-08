import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getOrgUnitControllerRemoveUrl } from '@/shared/api-sdk';

export const fetchOrgUnitDeleteMutation = defineAuthFetcher<
  HttpRequestDTO<{ unitId: string }>,
  undefined
>((http, request) =>
  http.request(getOrgUnitControllerRemoveUrl({ id: request.params.unitId }), { method: 'DELETE' }),
);
