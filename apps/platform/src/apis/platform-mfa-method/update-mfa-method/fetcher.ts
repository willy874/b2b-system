import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getPlatformMfaMethodControllerUpdateUrl } from '@/shared/api-sdk';
import type { PlatformMfaMethod, UpdatePlatformMfaMethodRequest } from '@/shared/api-sdk';

/** 全平台層的開關：on／off（緊急關閉，蓋過租戶層）／default。 */
export const fetchUpdateMfaMethodMutation = defineAuthFetcher<
  HttpRequestDTO<UpdatePlatformMfaMethodRequest & { id: string }>,
  PlatformMfaMethod
>((http, { params: { id, ...body } }) =>
  http.request(getPlatformMfaMethodControllerUpdateUrl({ id }), jsonBody(body, { method: 'PUT' })),
);
