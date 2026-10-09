import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getGalleryAlbumControllerRestoreUrl } from '@/shared/api-sdk';
import type { GalleryAlbum } from '@/shared/api-sdk';

export const fetchGalleryAlbumRestoreMutation = defineAuthFetcher<
  HttpRequestDTO<{ albumId: string }>,
  GalleryAlbum
>((http, request) =>
  http.request(getGalleryAlbumControllerRestoreUrl({ id: request.params.albumId }), {
    method: 'POST',
  }),
);
