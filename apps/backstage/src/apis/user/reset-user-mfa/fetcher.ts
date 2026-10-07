import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getUserMfaControllerResetUrl } from '@/shared/api-sdk';

/** 重設使用者的 MFA：刪除所有驗證方式與備用碼、結束對方所有的 session。 */
export const fetchResetUserMfaMutation = defineAuthFetcher<
  HttpRequestDTO<{ id: string }>,
  { success: boolean }
>((http, { params }) =>
  http.request(getUserMfaControllerResetUrl({ id: params.id }), { method: 'POST' }),
);
