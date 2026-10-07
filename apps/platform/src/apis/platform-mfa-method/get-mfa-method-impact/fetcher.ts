import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getPlatformMfaMethodControllerImpactUrl } from '@/shared/api-sdk';
import type { MfaMethodImpact } from '@/shared/api-sdk';

/** 關掉這個方式會被擋在門外的人數（全平台，或帶 `tenantId` 只看一個租戶）。關掉之前的確認框用。 */
export const fetchMfaMethodImpact = defineAuthFetcher<
  HttpRequestDTO<{ id: string; tenantId?: string }>,
  MfaMethodImpact
>((http, { params: { id, tenantId } }) =>
  http.request(withQuery(getPlatformMfaMethodControllerImpactUrl({ id }), { tenantId }), {
    method: 'GET',
  }),
);
