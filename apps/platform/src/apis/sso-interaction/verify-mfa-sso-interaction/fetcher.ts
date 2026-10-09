import { defineBaseFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getMfaInteractionControllerVerifyUrl } from '@/shared/api-sdk';
import type { MfaLoginVerifyRequest, MfaLoginVerifyResult } from '@/shared/api-sdk';

/**
 * 登入的第二步：驗證碼或備用碼；成功時回傳要頂層跳轉的 resume 網址。產品要求新增驗證方式時
 * （docs/architecture/backend/21-mfa.md §7.1）改成設定的下一步（`next: 'mfaEnroll'`）。
 */
export const fetchVerifyMfaSsoInteractionMutation = defineBaseFetcher<
  HttpRequestDTO<MfaLoginVerifyRequest & { uid: string }>,
  MfaLoginVerifyResult
>((http, { params }) =>
  http.request(
    getMfaInteractionControllerVerifyUrl({ uid: params.uid }),
    jsonBody(
      { factorId: params.factorId, challengeId: params.challengeId, payload: params.payload },
      { method: 'POST' },
    ),
  ),
);
