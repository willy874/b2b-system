import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getGroupControllerCreateUrl } from '@/shared/api-sdk';
import type { CreateGroupRequest, Group } from '@/shared/api-sdk';

export const fetchGroupCreateMutation = defineAuthFetcher<
  HttpRequestDTO<CreateGroupRequest>,
  Group
>((http, request) =>
  http.request(getGroupControllerCreateUrl(), jsonBody(request.params, { method: 'POST' })),
);
