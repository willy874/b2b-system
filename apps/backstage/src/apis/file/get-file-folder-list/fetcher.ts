import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getFileFolderControllerListUrl } from '@/shared/api-sdk';
import type { FileFolderList } from '@/shared/api-sdk';

export const fetchFileFolderListQuery = defineAuthFetcher<HttpRequestDTO<void>, FileFolderList>(
  (http) => http.request(getFileFolderControllerListUrl(), { method: 'GET' }),
);
