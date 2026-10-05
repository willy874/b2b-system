import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getGroupControllerRestoreUrl } from '@/shared/api-sdk';
import type { RestoredGroup } from '@/shared/api-sdk';

export const fetchGroupRestoreMutation = defineAuthFetcher<
  HttpRequestDTO<{ groupId: string }>,
  RestoredGroup
>((http, request) =>
  http.request(getGroupControllerRestoreUrl({ id: request.params.groupId }), { method: 'POST' }),
);
