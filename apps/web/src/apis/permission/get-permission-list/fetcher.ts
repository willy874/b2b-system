import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getPermissionControllerListUrl } from '@/shared/api-sdk';
import type { PermissionCatalog } from '@/shared/api-sdk';

export const fetchPermissionListQuery = defineAuthFetcher<
  HttpRequestDTO<void> | void,
  PermissionCatalog
>((http, request) =>
  http.request(getPermissionControllerListUrl(), {
    method: 'GET',
    signal: (request as HttpRequestDTO<void> | undefined)?.signal,
  }),
);
