import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import {
  getFileControllerAbortUploadUrl,
  getFileControllerCompleteUploadUrl,
  getFileControllerCreateUploadPartsUrl,
  getFileControllerCreateUploadUrl,
} from '@/shared/api-sdk';
import type {
  CompleteFileUploadRequest,
  CreateFileUploadRequest,
  FileUpload,
  FileUploadParts,
  StoredFile,
} from '@/shared/api-sdk';

import type { InWorkspace } from '../types';

/**
 * 上傳流程的後端步驟。刻意不拆成獨立的 `apis/file/<operation>/`：
 * 單獨呼叫任一步都沒有意義，對外只提供 `uploadFile()`（docs/architecture/backend/09-file.md §5）。
 */

export const fetchFileCreateUploadMutation = defineAuthFetcher<
  HttpRequestDTO<InWorkspace & CreateFileUploadRequest>,
  FileUpload
>((http, request) => {
  const { workspaceId, ...body } = request.params;
  return http.request(
    getFileControllerCreateUploadUrl({ workspaceId }),
    jsonBody(body, { method: 'POST' }),
  );
});

/** 分塊上傳：取得指定各塊的直傳網址。 */
export const fetchFileCreateUploadPartsMutation = defineAuthFetcher<
  HttpRequestDTO<InWorkspace & { fileId: string; partNumbers: number[] }>,
  FileUploadParts
>((http, request) =>
  http.request(
    getFileControllerCreateUploadPartsUrl({
      workspaceId: request.params.workspaceId,
      id: request.params.fileId,
    }),
    jsonBody({ partNumbers: request.params.partNumbers }, { method: 'POST' }),
  ),
);

export const fetchFileCompleteUploadMutation = defineAuthFetcher<
  HttpRequestDTO<InWorkspace & { fileId: string; body?: CompleteFileUploadRequest }>,
  StoredFile
>((http, request) =>
  http.request(
    getFileControllerCompleteUploadUrl({
      workspaceId: request.params.workspaceId,
      id: request.params.fileId,
    }),
    request.params.body ? jsonBody(request.params.body, { method: 'POST' }) : { method: 'POST' },
  ),
);

/** 放棄上傳：清掉已上傳的內容與分塊（失敗或取消時由 `uploadFile()` 呼叫）。 */
export const fetchFileAbortUploadMutation = defineAuthFetcher<
  HttpRequestDTO<InWorkspace & { fileId: string }>,
  undefined
>((http, request) =>
  http.request(
    getFileControllerAbortUploadUrl({
      workspaceId: request.params.workspaceId,
      id: request.params.fileId,
    }),
    { method: 'DELETE' },
  ),
);
