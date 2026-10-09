import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getGalleryAlbumControllerRemoveItemsUrl } from '@/shared/api-sdk';
import type { GalleryAlbumItemsRequest, GalleryAlbumItemsResult } from '@/shared/api-sdk';

export const fetchGalleryAlbumRemoveItemsMutation = defineAuthFetcher<
  HttpRequestDTO<{ albumId: string; body: GalleryAlbumItemsRequest }>,
  GalleryAlbumItemsResult
>((http, request) =>
  http.request(
    getGalleryAlbumControllerRemoveItemsUrl({ id: request.params.albumId }),
    jsonBody(request.params.body, { method: 'POST' }),
  ),
);
