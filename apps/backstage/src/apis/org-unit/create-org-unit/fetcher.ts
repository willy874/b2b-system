import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getOrgUnitControllerCreateUrl } from '@/shared/api-sdk';
import type { CreateOrgUnitRequest, OrgUnitDetail } from '@/shared/api-sdk';

export const fetchOrgUnitCreateMutation = defineAuthFetcher<
  HttpRequestDTO<{ body: CreateOrgUnitRequest }>,
  OrgUnitDetail
>((http, request) =>
  http.request(getOrgUnitControllerCreateUrl(), jsonBody(request.params.body, { method: 'POST' })),
);
