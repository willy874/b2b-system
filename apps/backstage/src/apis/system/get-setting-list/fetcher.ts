import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getSystemSettingControllerListUrl } from '@/shared/api-sdk';
import type { SystemSettingList } from '@/shared/api-sdk';

export const fetchSettingListQuery = defineAuthFetcher<HttpRequestDTO<void>, SystemSettingList>(
  (http) => http.request(getSystemSettingControllerListUrl(), { method: 'GET' }),
);
