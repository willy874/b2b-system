import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getImageControllerFindOneUrl } from '@/shared/api-sdk';
import type { ImageAsset } from '@/shared/api-sdk';

export const fetchImageQuery = defineAuthFetcher<HttpRequestDTO<{ id: string }>, ImageAsset>(
  (http, request) =>
    http.request(getImageControllerFindOneUrl({ id: request.params.id }), { method: 'GET' }),
);
