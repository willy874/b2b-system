import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getAuthControllerChangePasswordUrl } from '@/shared/api-sdk';
import type { ChangePasswordRequest } from '@/shared/api-sdk';

export const fetchChangePasswordMutation = defineAuthFetcher<
  HttpRequestDTO<ChangePasswordRequest>,
  { success: boolean }
>((http, request) =>
  http.request(getAuthControllerChangePasswordUrl(), jsonBody(request.params, { method: 'POST' })),
);
