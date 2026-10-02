import { defineBaseFetcher, withQuery } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getTenantControllerLookupUrl } from '@/shared/api-sdk';
import type { TenantLookup } from '@/shared/api-sdk';

/** 以代碼找租戶的登入入口（docs/architecture/05-tenancy.md §10.2 D11）。不需要登入。 */
export const fetchTenantLookupQuery = defineBaseFetcher<
  HttpRequestDTO<{ code: string }>,
  TenantLookup
>((http, request) =>
  http.request(withQuery(getTenantControllerLookupUrl(), request.params), { method: 'GET' }),
);
