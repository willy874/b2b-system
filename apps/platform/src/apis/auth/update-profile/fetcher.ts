import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getPlatformAuthControllerUpdateProfileUrl } from '@/shared/api-sdk';
import type { PlatformProfile, UpdatePlatformProfileRequest } from '@/shared/api-sdk';

/** 平台管理者改自己的顯示名稱（偏好只存在瀏覽器，沒有 `preferences`）。 */
export const fetchUpdateProfileMutation = defineAuthFetcher<
  HttpRequestDTO<UpdatePlatformProfileRequest>,
  PlatformProfile
>((http, request) =>
  http.request(
    getPlatformAuthControllerUpdateProfileUrl(),
    jsonBody(request.params, { method: 'PATCH' }),
  ),
);
