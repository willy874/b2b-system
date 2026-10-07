import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getPlatformAdminMfaControllerStatusUrl } from '@/shared/api-sdk';
import type { MfaAccountStatus } from '@/shared/api-sdk';

/** 平台管理者的驗證方式（不含機密）。 */
export const fetchAdminMfaQuery = defineAuthFetcher<
  HttpRequestDTO<{ id: string }>,
  MfaAccountStatus
>((http, { params }) =>
  http.request(getPlatformAdminMfaControllerStatusUrl({ id: params.id }), { method: 'GET' }),
);
