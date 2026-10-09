import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getGalleryAlbumControllerListUrl } from '@/shared/api-sdk';
import type { GalleryAlbumList } from '@/shared/api-sdk';

export const fetchGalleryAlbumsQuery = defineAuthFetcher<
  HttpRequestDTO<Record<string, never>>,
  GalleryAlbumList
>((http) => http.request(getGalleryAlbumControllerListUrl(), { method: 'GET' }));
