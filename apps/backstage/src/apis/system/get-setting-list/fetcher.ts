import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getSystemSettingControllerListUrl } from '@/shared/api-sdk';
import type { SystemSettingList } from '@/shared/api-sdk';

export const fetchSettingListQuery = defineAuthFetcher<HttpRequestDTO<void>, SystemSettingList>(
  (http) => http.request(getSystemSettingControllerListUrl(), { method: 'GET' }),
);
