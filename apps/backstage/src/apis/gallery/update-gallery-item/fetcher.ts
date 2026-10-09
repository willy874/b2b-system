import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getGalleryItemControllerUpdateUrl } from '@/shared/api-sdk';
import type { GalleryItemDetail, UpdateGalleryItemRequest } from '@/shared/api-sdk';

export const fetchGalleryItemUpdateMutation = defineAuthFetcher<
  HttpRequestDTO<{ itemId: string; body: UpdateGalleryItemRequest }>,
  GalleryItemDetail
>((http, request) =>
  http.request(
    getGalleryItemControllerUpdateUrl({ id: request.params.itemId }),
    jsonBody(request.params.body, { method: 'PATCH' }),
  ),
);
