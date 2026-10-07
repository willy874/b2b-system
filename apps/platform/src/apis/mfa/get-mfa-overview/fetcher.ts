import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getPlatformMfaSelfControllerOverviewUrl } from '@/shared/api-sdk';
import type { MfaOverview } from '@/shared/api-sdk';

/** 我的驗證方式、剩餘備用碼、可以設定的方式（docs/architecture/backend/21-mfa.md §7）。 */
export const fetchMfaOverviewQuery = defineAuthFetcher<HttpRequestDTO<void>, MfaOverview>((http) =>
  http.request(getPlatformMfaSelfControllerOverviewUrl(), { method: 'GET' }),
);
