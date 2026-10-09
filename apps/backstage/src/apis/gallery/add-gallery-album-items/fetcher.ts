import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getGalleryAlbumControllerAddItemsUrl } from '@/shared/api-sdk';
import type { GalleryAlbumItemsRequest, GalleryAlbumItemsResult } from '@/shared/api-sdk';

export const fetchGalleryAlbumAddItemsMutation = defineAuthFetcher<
  HttpRequestDTO<{ albumId: string; body: GalleryAlbumItemsRequest }>,
  GalleryAlbumItemsResult
>((http, request) =>
  http.request(
    getGalleryAlbumControllerAddItemsUrl({ id: request.params.albumId }),
    jsonBody(request.params.body, { method: 'POST' }),
  ),
);
