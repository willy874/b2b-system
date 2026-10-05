import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getSystemSettingControllerUpdateUrl } from '@/shared/api-sdk';
import type { SystemSettingList, UpdateSystemSettingsRequest } from '@/shared/api-sdk';

export const fetchUpdateSettingsMutation = defineAuthFetcher<
  HttpRequestDTO<UpdateSystemSettingsRequest>,
  SystemSettingList
>((http, request) =>
  http.request(
    getSystemSettingControllerUpdateUrl(),
    jsonBody(request.params, { method: 'PATCH' }),
  ),
);
