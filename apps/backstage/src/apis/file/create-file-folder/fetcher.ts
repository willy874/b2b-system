import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getFileFolderControllerCreateUrl } from '@/shared/api-sdk';
import type { CreateFileFolderRequest, FileFolder } from '@/shared/api-sdk';

export const fetchFileFolderCreateMutation = defineAuthFetcher<
  HttpRequestDTO<CreateFileFolderRequest>,
  FileFolder
>((http, request) =>
  http.request(getFileFolderControllerCreateUrl(), jsonBody(request.params, { method: 'POST' })),
);
