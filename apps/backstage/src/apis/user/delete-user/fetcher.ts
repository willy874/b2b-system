import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getUserControllerRemoveUrl } from '@/shared/api-sdk';

export const fetchUserDeleteMutation = defineAuthFetcher<
  HttpRequestDTO<{ userId: string }>,
  undefined
>((http, request) =>
  http.request(getUserControllerRemoveUrl({ id: request.params.userId }), { method: 'DELETE' }),
);
