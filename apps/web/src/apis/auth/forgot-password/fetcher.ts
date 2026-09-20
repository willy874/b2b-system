import { defineBaseFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getAuthControllerForgotPasswordUrl } from '@/shared/api-sdk';
import type { ForgotPasswordRequest } from '@/shared/api-sdk';

export const fetchForgotPasswordMutation = defineBaseFetcher<
  HttpRequestDTO<ForgotPasswordRequest>,
  { sent: boolean }
>((http, request) =>
  http.request(getAuthControllerForgotPasswordUrl(), jsonBody(request.params, { method: 'POST' })),
);
