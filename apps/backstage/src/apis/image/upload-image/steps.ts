import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import {
  getImageControllerCompleteUploadUrl,
  getImageControllerCreateUploadUrl,
} from '@/shared/api-sdk';
import type {
  CompleteImageUploadRequest,
  CreateImageUploadRequest,
  ImageAsset,
  ImageUpload,
} from '@/shared/api-sdk';

/**
 * 上傳的後端步驟。與檔案相同，刻意不拆成獨立的 `apis/image/<operation>/`：單獨呼叫任一步都沒有意義，
 * 對外只提供 `uploadImage()`（docs/architecture/backend/25-image.md §15.4）。
 */

export const fetchImageCreateUploadMutation = defineAuthFetcher<
  HttpRequestDTO<CreateImageUploadRequest>,
  ImageUpload
>((http, request) =>
  http.request(getImageControllerCreateUploadUrl(), jsonBody(request.params, { method: 'POST' })),
);

export const fetchImageCompleteUploadMutation = defineAuthFetcher<
  HttpRequestDTO<{ id: string; body: CompleteImageUploadRequest }>,
  ImageAsset
>((http, request) =>
  http.request(
    getImageControllerCompleteUploadUrl({ id: request.params.id }),
    jsonBody(request.params.body, { method: 'POST' }),
  ),
);
