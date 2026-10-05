import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getGroupControllerRemoveUrl } from '@/shared/api-sdk';

export const fetchGroupDeleteMutation = defineAuthFetcher<
  HttpRequestDTO<{ groupId: string }>,
  undefined
>((http, request) =>
  http.request(getGroupControllerRemoveUrl({ id: request.params.groupId }), { method: 'DELETE' }),
);
