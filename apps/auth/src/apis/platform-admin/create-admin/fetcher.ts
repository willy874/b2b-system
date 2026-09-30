import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getPlatformAdminControllerCreateUrl } from '@/shared/api-sdk';
import type { CreatePlatformAdminRequest, PlatformAdmin } from '@/shared/api-sdk';

/** 新增平台管理者：建立成 pending，後端寄啟用信讓本人設定密碼。 */
export const fetchCreateAdminMutation = defineAuthFetcher<
  HttpRequestDTO<CreatePlatformAdminRequest>,
  PlatformAdmin
>((http, request) =>
  http.request(getPlatformAdminControllerCreateUrl(), jsonBody(request.params, { method: 'POST' })),
);
