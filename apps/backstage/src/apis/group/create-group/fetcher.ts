import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getGroupControllerCreateUrl } from '@/shared/api-sdk';
import type { CreateGroupRequest, Group } from '@/shared/api-sdk';

export const fetchGroupCreateMutation = defineAuthFetcher<
  HttpRequestDTO<CreateGroupRequest>,
  Group
>((http, request) =>
  http.request(getGroupControllerCreateUrl(), jsonBody(request.params, { method: 'POST' })),
);
