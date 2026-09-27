import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import {
  getFileControllerCompleteUploadUrl,
  getFileControllerCreateUploadUrl,
} from '@/shared/api-sdk';
import type { CreateFileUploadRequest, FileUpload, StoredFile } from '@/shared/api-sdk';

/**
 * 上傳流程的兩個後端步驟。刻意不拆成獨立的 `apis/file/<operation>/`：
 * 單獨呼叫任一步都沒有意義，對外只提供 `uploadFile()`（docs/architecture/backend/09-file.md §5）。
 */

export const fetchFileCreateUploadMutation = defineAuthFetcher<
  HttpRequestDTO<CreateFileUploadRequest>,
  FileUpload
>((http, request) =>
  http.request(getFileControllerCreateUploadUrl(), jsonBody(request.params, { method: 'POST' })),
);

export const fetchFileCompleteUploadMutation = defineAuthFetcher<
  HttpRequestDTO<{ fileId: string }>,
  StoredFile
>((http, request) =>
  http.request(getFileControllerCompleteUploadUrl({ id: request.params.fileId }), {
    method: 'POST',
  }),
);
