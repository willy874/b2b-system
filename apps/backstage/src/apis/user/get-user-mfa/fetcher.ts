import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getUserMfaControllerStatusUrl } from '@/shared/api-sdk';
import type { MfaAccountStatus } from '@/shared/api-sdk';

/** 使用者的驗證方式（不含機密）。 */
export const fetchUserMfaQuery = defineAuthFetcher<
  HttpRequestDTO<{ id: string }>,
  MfaAccountStatus
>((http, { params }) =>
  http.request(getUserMfaControllerStatusUrl({ id: params.id }), { method: 'GET' }),
);
