import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getImageControllerHideFromRecentUrl } from '@/shared/api-sdk';

export const fetchHideRecentImageMutation = defineAuthFetcher<HttpRequestDTO<{ id: string }>, void>(
  (http, request) =>
    http.request(getImageControllerHideFromRecentUrl({ id: request.params.id }), {
      method: 'POST',
    }),
);
