import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getFileFolderControllerListUrl } from '@/shared/api-sdk';
import type { FileFolderList } from '@/shared/api-sdk';

export const fetchFileFolderListQuery = defineAuthFetcher<HttpRequestDTO<void>, FileFolderList>(
  (http) => http.request(getFileFolderControllerListUrl(), { method: 'GET' }),
);
