import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getGroupControllerFindOneUrl } from '@/shared/api-sdk';
import type { Group } from '@/shared/api-sdk';

export const fetchGroupDetailQuery = defineAuthFetcher<HttpRequestDTO<{ groupId: string }>, Group>(
  (http, request) =>
    http.request(getGroupControllerFindOneUrl({ id: request.params.groupId }), { method: 'GET' }),
);
