import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getMfaSelfControllerConfirmUrl } from '@/shared/api-sdk';
import type { ConfirmMfaEnrollmentRequest, MfaEnrollmentResult } from '@/shared/api-sdk';

/** 確認設定；第一個因子同時回傳備用碼（只出現這一次）。 */
export const fetchConfirmMfaEnrollmentMutation = defineAuthFetcher<
  HttpRequestDTO<ConfirmMfaEnrollmentRequest & { factorId: string }>,
  MfaEnrollmentResult
>((http, { params }) =>
  http.request(
    getMfaSelfControllerConfirmUrl({ id: params.factorId }),
    jsonBody(
      { challengeId: params.challengeId, payload: params.payload, label: params.label },
      { method: 'POST' },
    ),
  ),
);
