import { defineBaseFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getAuthControllerResetPasswordUrl } from '@/shared/api-sdk';
import type { ResetPasswordRequest } from '@/shared/api-sdk';

export const fetchResetPasswordMutation = defineBaseFetcher<
  HttpRequestDTO<ResetPasswordRequest>,
  { success: boolean }
>((http, request) =>
  http.request(getAuthControllerResetPasswordUrl(), jsonBody(request.params, { method: 'POST' })),
);
