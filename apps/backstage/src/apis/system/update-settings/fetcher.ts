import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
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
