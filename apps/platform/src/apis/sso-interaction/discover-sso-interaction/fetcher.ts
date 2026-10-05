import { defineBaseFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getSsoInteractionControllerDiscoverUrl } from '@/shared/api-sdk';
import type { SsoDiscovery } from '@/shared/api-sdk';

/** email 網域 → 外部 IdP 連線（home realm discovery）。公開端點，憑證是互動 cookie。 */
export const fetchDiscoverSsoInteractionQuery = defineBaseFetcher<
  HttpRequestDTO<{ uid: string; email: string }>,
  SsoDiscovery
>((http, { params: { uid, email } }) =>
  http.request(withQuery(getSsoInteractionControllerDiscoverUrl({ uid }), { email }), {
    method: 'GET',
  }),
);
