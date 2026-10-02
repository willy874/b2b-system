import { defineAuthFetcher, withQuery } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getTagControllerListUrl } from '@/shared/api-sdk';
import type { TagList } from '@/shared/api-sdk';

import type { TagScope } from '../types';

export const fetchTagListQuery = defineAuthFetcher<HttpRequestDTO<{ scope: TagScope }>, TagList>(
  (http, request) =>
    http.request(withQuery(getTagControllerListUrl(), { scope: request.params.scope }), {
      method: 'GET',
    }),
);
