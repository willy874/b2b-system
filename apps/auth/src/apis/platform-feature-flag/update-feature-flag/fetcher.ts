import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getPlatformFeatureFlagControllerUpdateUrl } from '@/shared/api-sdk';
import type { FeatureFlag, UpdateFeatureFlagRequest } from '@/shared/api-sdk';

/** 全平台層的覆寫：`on` 全面開放、`off` 緊急關閉（蓋過租戶層）、`default` 移除覆寫。 */
export const fetchUpdateFeatureFlagMutation = defineAuthFetcher<
  HttpRequestDTO<{ key: string; body: UpdateFeatureFlagRequest }>,
  FeatureFlag
>((http, request) =>
  http.request(
    getPlatformFeatureFlagControllerUpdateUrl({ key: request.params.key }),
    jsonBody(request.params.body, { method: 'PUT' }),
  ),
);
