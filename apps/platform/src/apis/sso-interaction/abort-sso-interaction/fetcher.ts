import { defineBaseFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getSsoInteractionControllerAbortUrl } from '@/shared/api-sdk';
import type { SsoRedirect } from '@/shared/api-sdk';

/** 取消登入；產品收到 `error=access_denied`。 */
export const fetchAbortSsoInteractionMutation = defineBaseFetcher<
  HttpRequestDTO<{ uid: string }>,
  SsoRedirect
>((http, request) =>
  http.request(getSsoInteractionControllerAbortUrl({ uid: request.params.uid }), {
    method: 'POST',
  }),
);
