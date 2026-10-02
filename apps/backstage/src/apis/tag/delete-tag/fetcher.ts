import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getTagControllerRemoveUrl } from '@/shared/api-sdk';

export const fetchTagDeleteMutation = defineAuthFetcher<
  HttpRequestDTO<{ tagId: string }>,
  undefined
>((http, request) =>
  http.request(getTagControllerRemoveUrl({ id: request.params.tagId }), { method: 'DELETE' }),
);
