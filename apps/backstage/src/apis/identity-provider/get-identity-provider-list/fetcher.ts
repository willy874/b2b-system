import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getIdentityProviderControllerListUrl } from '@/shared/api-sdk';
import type { IdentityProviderList } from '@/shared/api-sdk';

export const fetchIdentityProviderListQuery = defineAuthFetcher<
  HttpRequestDTO<void>,
  IdentityProviderList
>((http) => http.request(getIdentityProviderControllerListUrl(), { method: 'GET' }));
