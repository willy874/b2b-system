import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getGroupControllerRestoreUrl } from '@/shared/api-sdk';
import type { RestoredGroup } from '@/shared/api-sdk';

export const fetchGroupRestoreMutation = defineAuthFetcher<
  HttpRequestDTO<{ groupId: string }>,
  RestoredGroup
>((http, request) =>
  http.request(getGroupControllerRestoreUrl({ id: request.params.groupId }), { method: 'POST' }),
);
