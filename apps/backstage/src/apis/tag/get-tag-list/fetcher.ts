import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getTagControllerListUrl } from '@/shared/api-sdk';
import type { TagList } from '@/shared/api-sdk';

import type { TagScope } from '../types';

export const fetchTagListQuery = defineAuthFetcher<HttpRequestDTO<{ scope: TagScope }>, TagList>(
  (http, request) =>
    http.request(withQuery(getTagControllerListUrl(), { scope: request.params.scope }), {
      method: 'GET',
    }),
);
