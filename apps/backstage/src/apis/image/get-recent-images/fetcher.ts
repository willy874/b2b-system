import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getImageControllerRecentUrl } from '@/shared/api-sdk';
import type { ImageAssetList } from '@/shared/api-sdk';

export const fetchRecentImagesQuery = defineAuthFetcher<
  HttpRequestDTO<{ usage: string }>,
  ImageAssetList
>((http, request) =>
  http.request(withQuery(getImageControllerRecentUrl(), { usage: request.params.usage }), {
    method: 'GET',
  }),
);
