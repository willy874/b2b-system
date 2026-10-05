import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getTagControllerRemoveUrl } from '@/shared/api-sdk';

export const fetchTagDeleteMutation = defineAuthFetcher<
  HttpRequestDTO<{ tagId: string }>,
  undefined
>((http, request) =>
  http.request(getTagControllerRemoveUrl({ id: request.params.tagId }), { method: 'DELETE' }),
);
