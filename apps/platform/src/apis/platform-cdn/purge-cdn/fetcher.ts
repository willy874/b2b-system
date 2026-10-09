import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getPlatformCdnControllerPurgeUrl } from '@/shared/api-sdk';
import type { CdnPurgeRequest, CdnPurgeResult } from '@/shared/api-sdk';

/** 手動清理（`cdn:purge`；整個快取另要 `cdn:purgeAll`）：`202 { jobIds }`，結果在背景工作列表。 */
export const fetchPurgeCdnMutation = defineAuthFetcher<
  HttpRequestDTO<CdnPurgeRequest>,
  CdnPurgeResult
>((http, { params }) =>
  http.request(getPlatformCdnControllerPurgeUrl(), jsonBody(params, { method: 'POST' })),
);
