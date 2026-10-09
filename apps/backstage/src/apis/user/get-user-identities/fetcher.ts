import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getUserIdentityControllerListUrl } from '@/shared/api-sdk';
import type { UserIdentityList } from '@/shared/api-sdk';

/** 使用者連結的外部身分（docs/architecture/04-sso.md §3.3.4）。 */
export const fetchUserIdentitiesQuery = defineAuthFetcher<
  HttpRequestDTO<{ userId: string }>,
  UserIdentityList
>((http, { params }) =>
  http.request(getUserIdentityControllerListUrl({ userId: params.userId }), { method: 'GET' }),
);
