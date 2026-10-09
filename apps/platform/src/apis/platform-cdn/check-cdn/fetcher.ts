import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getPlatformCdnControllerCheckUrl } from '@/shared/api-sdk';
import type { CdnCheckResult } from '@/shared/api-sdk';

/** 執行邊緣的檢查（`cdn:read`）；10 秒內重複呼叫回上一次的結果。 */
export const fetchCheckCdnMutation = defineAuthFetcher<HttpRequestDTO<void>, CdnCheckResult>(
  (http) => http.request(getPlatformCdnControllerCheckUrl(), { method: 'POST' }),
);
