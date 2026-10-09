import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getPlatformCdnControllerOverviewUrl } from '@/shared/api-sdk';
import type { CdnOverview } from '@/shared/api-sdk';

/** 部署資訊、存放的設定與生效值、最近一次檢查、最近的清理（docs/architecture/backend/09-file.md §16.12）。 */
export const fetchCdnOverviewQuery = defineAuthFetcher<HttpRequestDTO<void>, CdnOverview>((http) =>
  http.request(getPlatformCdnControllerOverviewUrl(), { method: 'GET' }),
);
