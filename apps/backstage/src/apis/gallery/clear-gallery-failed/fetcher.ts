import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getGalleryItemControllerClearFailedUrl } from '@/shared/api-sdk';

export const fetchGalleryClearFailedMutation = defineAuthFetcher<
  HttpRequestDTO<Record<string, never>>,
  undefined
>((http) => http.request(getGalleryItemControllerClearFailedUrl(), { method: 'DELETE' }));
