import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getIdentityProviderControllerCreateUrl } from '@/shared/api-sdk';
import type { CreateIdentityProviderRequest, IdentityProvider } from '@/shared/api-sdk';

export const fetchCreateIdentityProviderMutation = defineAuthFetcher<
  HttpRequestDTO<CreateIdentityProviderRequest>,
  IdentityProvider
>((http, request) =>
  http.request(
    getIdentityProviderControllerCreateUrl(),
    jsonBody(request.params, { method: 'POST' }),
  ),
);
