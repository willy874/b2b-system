import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getPlatformAuthControllerProfileUrl } from '@/shared/api-sdk';
import type { PlatformProfile } from '@/shared/api-sdk';

/** 平台管理者自己的身分（apps/platform 只給平台管理者登入，docs/architecture/05-tenancy.md §10.2 D5）。 */
export const fetchProfileQuery = defineAuthFetcher<HttpRequestDTO<void>, PlatformProfile>((http) =>
  http.request(getPlatformAuthControllerProfileUrl(), { method: 'GET' }),
);
