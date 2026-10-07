import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getPlatformMfaMethodControllerListUrl } from '@/shared/api-sdk';
import type { PlatformMfaMethodList } from '@/shared/api-sdk';

/** MFA 的驗證方式、全平台狀態、覆寫的租戶數、已設定的因子數（docs/architecture/backend/21-mfa.md §5）。 */
export const fetchMfaMethodListQuery = defineAuthFetcher<
  HttpRequestDTO<void>,
  PlatformMfaMethodList
>((http) => http.request(getPlatformMfaMethodControllerListUrl(), { method: 'GET' }));
