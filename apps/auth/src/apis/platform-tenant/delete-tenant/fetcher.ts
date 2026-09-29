import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getPlatformTenantControllerRemoveUrl } from '@/shared/api-sdk';

/** 標記刪除並釋出網域；database 與 bucket 由手動步驟清除。 */
export const fetchDeleteTenantMutation = defineAuthFetcher<
  HttpRequestDTO<{ id: string }>,
  undefined
>((http, request) =>
  http.request(getPlatformTenantControllerRemoveUrl({ id: request.params.id }), {
    method: 'DELETE',
  }),
);
