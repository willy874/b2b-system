import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getFileFolderGrantControllerSetUrl } from '@/shared/api-sdk';
import type { FileFolderGrantList, SetFileFolderGrantRequest } from '@/shared/api-sdk';

/** 新增或變更一筆授權（同一對象只有一筆，變更等級是覆寫）。 */
export const fetchFileFolderGrantSetMutation = defineAuthFetcher<
  HttpRequestDTO<{ folderId: string; body: SetFileFolderGrantRequest }>,
  FileFolderGrantList
>((http, request) =>
  http.request(
    getFileFolderGrantControllerSetUrl({ id: request.params.folderId }),
    jsonBody(request.params.body, { method: 'PUT' }),
  ),
);
