import { defineBaseFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getMfaInteractionControllerConfirmEnrollmentUrl } from '@/shared/api-sdk';
import type { ConfirmMfaEnrollmentRequest, MfaInteractionEnrollmentResult } from '@/shared/api-sdk';

/** 互動中的設定：確認驗證碼；回傳備用碼與 resume 網址。 */
export const fetchConfirmMfaEnrollmentSsoInteractionMutation = defineBaseFetcher<
  HttpRequestDTO<ConfirmMfaEnrollmentRequest & { uid: string; factorId: string }>,
  MfaInteractionEnrollmentResult
>((http, { params }) =>
  http.request(
    getMfaInteractionControllerConfirmEnrollmentUrl({ uid: params.uid, factorId: params.factorId }),
    jsonBody(
      { challengeId: params.challengeId, payload: params.payload, label: params.label },
      { method: 'POST' },
    ),
  ),
);
