import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getIdentityProviderControllerRemoveUrl } from '@/shared/api-sdk';

export const fetchDeleteIdentityProviderMutation = defineAuthFetcher<
  HttpRequestDTO<{ id: string }>,
  undefined
>((http, request) =>
  http.request(getIdentityProviderControllerRemoveUrl({ id: request.params.id }), {
    method: 'DELETE',
  }),
);
