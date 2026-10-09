import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getGalleryItemControllerRemoveUrl } from '@/shared/api-sdk';

export const fetchGalleryItemDeleteMutation = defineAuthFetcher<
  HttpRequestDTO<{ itemId: string }>,
  undefined
>((http, request) =>
  http.request(getGalleryItemControllerRemoveUrl({ id: request.params.itemId }), {
    method: 'DELETE',
  }),
);
