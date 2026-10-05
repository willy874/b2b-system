import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getGroupControllerUpdateUrl } from '@/shared/api-sdk';
import type { Group, UpdateGroupRequest } from '@/shared/api-sdk';

export const fetchGroupUpdateMutation = defineAuthFetcher<
  HttpRequestDTO<{ groupId: string; body: UpdateGroupRequest }>,
  Group
>((http, request) =>
  http.request(
    getGroupControllerUpdateUrl({ id: request.params.groupId }),
    jsonBody(request.params.body, { method: 'PATCH' }),
  ),
);
