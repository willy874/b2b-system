import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getOrgUnitControllerListUrl } from '@/shared/api-sdk';
import type { OrgUnitTree } from '@/shared/api-sdk';

export const fetchOrgUnitTreeQuery = defineAuthFetcher<
  HttpRequestDTO<{ keyword?: string }>,
  OrgUnitTree
>((http, request) =>
  http.request(withQuery(getOrgUnitControllerListUrl(), { keyword: request.params.keyword }), {
    method: 'GET',
  }),
);
