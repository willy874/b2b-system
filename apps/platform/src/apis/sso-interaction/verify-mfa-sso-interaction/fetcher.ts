import { defineBaseFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getMfaInteractionControllerVerifyUrl } from '@/shared/api-sdk';
import type { MfaLoginVerifyRequest, SsoRedirect } from '@/shared/api-sdk';

/** 登入的第二步：驗證碼或備用碼；成功時回傳要頂層跳轉的 resume 網址。 */
export const fetchVerifyMfaSsoInteractionMutation = defineBaseFetcher<
  HttpRequestDTO<MfaLoginVerifyRequest & { uid: string }>,
  SsoRedirect
>((http, { params }) =>
  http.request(
    getMfaInteractionControllerVerifyUrl({ uid: params.uid }),
    jsonBody(
      { factorId: params.factorId, challengeId: params.challengeId, payload: params.payload },
      { method: 'POST' },
    ),
  ),
);
