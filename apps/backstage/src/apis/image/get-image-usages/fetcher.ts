import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getImageControllerListUsagesUrl } from '@/shared/api-sdk';
import type { ImageUsageList } from '@/shared/api-sdk';

export const fetchImageUsagesQuery = defineAuthFetcher<HttpRequestDTO<void>, ImageUsageList>(
  (http) => http.request(getImageControllerListUsagesUrl(), { method: 'GET' }),
);
