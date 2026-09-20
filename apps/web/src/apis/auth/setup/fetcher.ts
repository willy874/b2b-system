import { defineBaseFetcher, jsonBody, withQuery } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getAuthControllerSetupUrl, getAuthControllerVerifySetupUrl } from '@/shared/api-sdk';
import type { SetupRequest } from '@/shared/api-sdk';

export const fetchSetupMutation = defineBaseFetcher<
  HttpRequestDTO<SetupRequest>,
  { success: boolean }
>((http, request) =>
  http.request(getAuthControllerSetupUrl(), jsonBody(request.params, { method: 'POST' })),
);

export const fetchVerifySetupQuery = defineBaseFetcher<
  HttpRequestDTO<{ token: string }>,
  { valid: boolean; email?: string }
>((http, request) =>
  http.request(withQuery(getAuthControllerVerifySetupUrl(), request.params), {
    method: 'GET',
    signal: request.signal,
  }),
);
