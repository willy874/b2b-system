import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getGalleryAlbumControllerUpdateUrl } from '@/shared/api-sdk';
import type { GalleryAlbum, UpdateGalleryAlbumRequest } from '@/shared/api-sdk';

export const fetchGalleryAlbumUpdateMutation = defineAuthFetcher<
  HttpRequestDTO<{ albumId: string; body: UpdateGalleryAlbumRequest }>,
  GalleryAlbum
>((http, request) =>
  http.request(
    getGalleryAlbumControllerUpdateUrl({ id: request.params.albumId }),
    jsonBody(request.params.body, { method: 'PATCH' }),
  ),
);
