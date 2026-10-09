import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getGalleryItemControllerFindOneUrl } from '@/shared/api-sdk';
import type { GalleryItemDetail } from '@/shared/api-sdk';

export const fetchGalleryItemQuery = defineAuthFetcher<
  HttpRequestDTO<{ itemId: string }>,
  GalleryItemDetail
>((http, request) =>
  http.request(getGalleryItemControllerFindOneUrl({ id: request.params.itemId }), {
    method: 'GET',
  }),
);
