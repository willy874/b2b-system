import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import {
  getGalleryItemControllerCompleteUploadUrl,
  getGalleryItemControllerCreateUploadUrl,
} from '@/shared/api-sdk';
import type {
  CreateGalleryUploadRequest,
  GalleryUpload,
  GalleryUploadItem,
} from '@/shared/api-sdk';

/**
 * 上傳的後端步驟。與檔案相同，刻意不拆成獨立的 `apis/gallery/<operation>/`：單獨呼叫任一步都沒有意義，
 * 對外只提供 `uploadGalleryItem()`（docs/architecture/backend/26-gallery.md §4）。
 */

export const fetchGalleryCreateUploadMutation = defineAuthFetcher<
  HttpRequestDTO<CreateGalleryUploadRequest>,
  GalleryUpload
>((http, request) =>
  http.request(
    getGalleryItemControllerCreateUploadUrl(),
    jsonBody(request.params, { method: 'POST' }),
  ),
);

export const fetchGalleryCompleteUploadMutation = defineAuthFetcher<
  HttpRequestDTO<{ id: string }>,
  GalleryUploadItem
>((http, request) =>
  http.request(getGalleryItemControllerCompleteUploadUrl({ id: request.params.id }), {
    method: 'POST',
  }),
);
