import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getPlatformAuthControllerChangePasswordUrl } from '@/shared/api-sdk';
import type { ChangePasswordRequest } from '@/shared/api-sdk';

/** 換密碼會結束平台管理者的所有 session（包含這一個）。 */
export const fetchChangePasswordMutation = defineAuthFetcher<
  HttpRequestDTO<ChangePasswordRequest>,
  { success: boolean }
>((http, request) =>
  http.request(
    getPlatformAuthControllerChangePasswordUrl(),
    jsonBody(request.params, { method: 'POST' }),
  ),
);
