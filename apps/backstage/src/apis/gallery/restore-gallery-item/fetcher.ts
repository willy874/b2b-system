import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getGalleryItemControllerRestoreUrl } from '@/shared/api-sdk';
import type { GalleryItemDetail } from '@/shared/api-sdk';

export const fetchGalleryItemRestoreMutation = defineAuthFetcher<
  HttpRequestDTO<{ itemId: string }>,
  GalleryItemDetail
>((http, request) =>
  http.request(getGalleryItemControllerRestoreUrl({ id: request.params.itemId }), {
    method: 'POST',
  }),
);
