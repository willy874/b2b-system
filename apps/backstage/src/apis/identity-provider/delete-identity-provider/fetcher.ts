import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getIdentityProviderControllerRemoveUrl } from '@/shared/api-sdk';

export const fetchDeleteIdentityProviderMutation = defineAuthFetcher<
  HttpRequestDTO<{ id: string }>,
  undefined
>((http, request) =>
  http.request(getIdentityProviderControllerRemoveUrl({ id: request.params.id }), {
    method: 'DELETE',
  }),
);
