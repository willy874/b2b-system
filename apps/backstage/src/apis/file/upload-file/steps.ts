import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import {
  getFileControllerAbortUploadUrl,
  getFileControllerCompleteUploadUrl,
  getFileControllerCreateUploadPartsUrl,
  getFileControllerCreateUploadUrl,
  getFileControllerFindOneUrl,
} from '@/shared/api-sdk';
import type {
  CompleteFileUploadRequest,
  CreateFileUploadRequest,
  FileUpload,
  FileUploadParts,
  StoredFile,
} from '@/shared/api-sdk';

/**
 * 上傳流程的後端步驟。刻意不拆成獨立的 `apis/file/<operation>/`：
 * 單獨呼叫任一步都沒有意義，對外只提供 `uploadFile()`（docs/architecture/backend/09-file.md §5）。
 */

export const fetchFileCreateUploadMutation = defineAuthFetcher<
  HttpRequestDTO<CreateFileUploadRequest>,
  FileUpload
>((http, request) =>
  http.request(getFileControllerCreateUploadUrl(), jsonBody(request.params, { method: 'POST' })),
);

/** 分塊上傳：取得指定各塊的直傳網址。 */
export const fetchFileCreateUploadPartsMutation = defineAuthFetcher<
  HttpRequestDTO<{ fileId: string; partNumbers: number[] }>,
  FileUploadParts
>((http, request) =>
  http.request(
    getFileControllerCreateUploadPartsUrl({ id: request.params.fileId }),
    jsonBody({ partNumbers: request.params.partNumbers }, { method: 'POST' }),
  ),
);

export const fetchFileCompleteUploadMutation = defineAuthFetcher<
  HttpRequestDTO<{ fileId: string; body?: CompleteFileUploadRequest }>,
  StoredFile
>((http, request) =>
  http.request(
    getFileControllerCompleteUploadUrl({ id: request.params.fileId }),
    request.params.body ? jsonBody(request.params.body, { method: 'POST' }) : { method: 'POST' },
  ),
);

/** 放棄上傳：清掉已上傳的內容與分塊（失敗或取消時由 `uploadFile()` 呼叫）。 */
export const fetchFileAbortUploadMutation = defineAuthFetcher<
  HttpRequestDTO<{ fileId: string }>,
  undefined
>((http, request) =>
  http.request(getFileControllerAbortUploadUrl({ id: request.params.fileId }), {
    method: 'DELETE',
  }),
);

/** 查詢這次上傳的目前狀態（`complete` 的回應遺失時，確認伺服器端其實已經完成）。 */
export const fetchFileUploadStatusQuery = defineAuthFetcher<
  HttpRequestDTO<{ fileId: string }>,
  StoredFile
>((http, request) =>
  http.request(getFileControllerFindOneUrl({ id: request.params.fileId }), { method: 'GET' }),
);
