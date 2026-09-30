import { defineBaseFetcher } from '@/core/client';
import { getPlatformAuthControllerRefreshUrl } from '@/shared/api-sdk';
import type { Session } from '@/shared/api-sdk';

/** `x-refresh-request: 1` 是 CSRF 緩解（後端會檢查）。 */
export const fetchRefreshMutation = defineBaseFetcher<void, Session>((http) =>
  http.request(getPlatformAuthControllerRefreshUrl(), {
    method: 'POST',
    headers: { 'x-refresh-request': '1' },
    credentials: 'same-origin',
  }),
);
