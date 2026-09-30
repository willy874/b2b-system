import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getPlatformAdminControllerSendPasswordLinkUrl } from '@/shared/api-sdk';
import type { PlatformAdminPasswordLink } from '@/shared/api-sdk';

/** 寄設定密碼的連結；回傳寄了哪一種信（還沒啟用的是啟用信，其他人是重設密碼信）。 */
export const fetchSendAdminPasswordLinkMutation = defineAuthFetcher<
  HttpRequestDTO<{ id: string }>,
  PlatformAdminPasswordLink
>((http, request) =>
  http.request(getPlatformAdminControllerSendPasswordLinkUrl({ id: request.params.id }), {
    method: 'POST',
  }),
);
