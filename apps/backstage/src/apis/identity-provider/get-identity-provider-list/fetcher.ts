import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getIdentityProviderControllerListUrl } from '@/shared/api-sdk';
import type { IdentityProviderList } from '@/shared/api-sdk';

export const fetchIdentityProviderListQuery = defineAuthFetcher<
  HttpRequestDTO<void>,
  IdentityProviderList
>((http) => http.request(getIdentityProviderControllerListUrl(), { method: 'GET' }));
