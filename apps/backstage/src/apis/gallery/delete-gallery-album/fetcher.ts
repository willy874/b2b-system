import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getGalleryAlbumControllerRemoveUrl } from '@/shared/api-sdk';

export const fetchGalleryAlbumDeleteMutation = defineAuthFetcher<
  HttpRequestDTO<{ albumId: string }>,
  undefined
>((http, request) =>
  http.request(getGalleryAlbumControllerRemoveUrl({ id: request.params.albumId }), {
    method: 'DELETE',
  }),
);
