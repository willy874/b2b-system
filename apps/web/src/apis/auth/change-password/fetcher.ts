import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getAuthControllerChangePasswordUrl } from '@/shared/api-sdk';
import type { ChangePasswordRequest } from '@/shared/api-sdk';

export const fetchChangePasswordMutation = defineAuthFetcher<
  HttpRequestDTO<ChangePasswordRequest>,
  { success: boolean }
>((http, request) =>
  http.request(getAuthControllerChangePasswordUrl(), jsonBody(request.params, { method: 'POST' })),
);
