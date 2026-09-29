import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getFileFolderGrantControllerListUrl } from '@/shared/api-sdk';
import type { FileFolderGrantList } from '@/shared/api-sdk';

export const fetchFileFolderGrantListQuery = defineAuthFetcher<
  HttpRequestDTO<{ folderId: string }>,
  FileFolderGrantList
>((http, request) =>
  http.request(getFileFolderGrantControllerListUrl({ id: request.params.folderId }), {
    method: 'GET',
  }),
);
