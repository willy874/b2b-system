import { defineBaseFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getSsoInteractionControllerPasskeyOptionsUrl } from '@/shared/api-sdk';
import type { SsoPasskeyOptions } from '@/shared/api-sdk';

/** 通行金鑰登入的 challenge（docs/architecture/04-sso.md §3.6）：給瀏覽器 API 的 options。 */
export const fetchPasskeyOptionsSsoInteractionMutation = defineBaseFetcher<
  HttpRequestDTO<{ uid: string }>,
  SsoPasskeyOptions
>((http, { params: { uid } }) =>
  http.request(getSsoInteractionControllerPasskeyOptionsUrl({ uid }), { method: 'POST' }),
);
