import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
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
