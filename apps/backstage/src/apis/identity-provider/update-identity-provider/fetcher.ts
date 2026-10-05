import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getIdentityProviderControllerUpdateUrl } from '@/shared/api-sdk';
import type { IdentityProvider, UpdateIdentityProviderRequest } from '@/shared/api-sdk';

export const fetchUpdateIdentityProviderMutation = defineAuthFetcher<
  HttpRequestDTO<{ id: string; body: UpdateIdentityProviderRequest }>,
  IdentityProvider
>((http, request) =>
  http.request(
    getIdentityProviderControllerUpdateUrl({ id: request.params.id }),
    jsonBody(request.params.body, { method: 'PATCH' }),
  ),
);
