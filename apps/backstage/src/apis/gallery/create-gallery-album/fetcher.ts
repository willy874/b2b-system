import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getGalleryAlbumControllerCreateUrl } from '@/shared/api-sdk';
import type { CreateGalleryAlbumRequest, GalleryAlbum } from '@/shared/api-sdk';

export const fetchGalleryAlbumCreateMutation = defineAuthFetcher<
  HttpRequestDTO<{ body: CreateGalleryAlbumRequest }>,
  GalleryAlbum
>((http, request) =>
  http.request(
    getGalleryAlbumControllerCreateUrl(),
    jsonBody(request.params.body, { method: 'POST' }),
  ),
);
