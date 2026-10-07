import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getPlatformAdminMfaControllerResetUrl } from '@/shared/api-sdk';

/** 重設平台管理者的 MFA（不能重設自己）；結束對方所有的 session。 */
export const fetchResetAdminMfaMutation = defineAuthFetcher<
  HttpRequestDTO<{ id: string }>,
  { success: boolean }
>((http, { params }) =>
  http.request(getPlatformAdminMfaControllerResetUrl({ id: params.id }), { method: 'POST' }),
);
