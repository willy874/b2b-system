import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getGalleryItemControllerUploadsUrl } from '@/shared/api-sdk';
import type { GalleryUploadStatus } from '@/shared/api-sdk';

export const fetchGalleryUploadsQuery = defineAuthFetcher<
  HttpRequestDTO<Record<string, never>>,
  GalleryUploadStatus
>((http) => http.request(getGalleryItemControllerUploadsUrl(), { method: 'GET' }));
