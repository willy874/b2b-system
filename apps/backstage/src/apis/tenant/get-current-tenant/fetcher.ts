import { defineBaseFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getTenantControllerCurrentUrl } from '@/shared/api-sdk';
import type { CurrentTenant } from '@/shared/api-sdk';

/**
 * 這個網域的租戶（docs/adr/0020-physical-tenant-isolation.md D7）。登入前就要知道，所以用 base fetcher。
 * backstage 本身不在乎租戶，只在跳去 apps/auth 登入時帶上它的代碼。
 */
export const fetchCurrentTenantQuery = defineBaseFetcher<HttpRequestDTO<void>, CurrentTenant>(
  (http) => http.request(getTenantControllerCurrentUrl(), { method: 'GET' }),
);
