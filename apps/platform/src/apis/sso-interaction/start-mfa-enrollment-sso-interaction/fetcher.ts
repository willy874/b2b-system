import { defineBaseFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getMfaInteractionControllerStartEnrollmentUrl } from '@/shared/api-sdk';
import type { MfaEnrollment, StartMfaEnrollmentRequest } from '@/shared/api-sdk';

/** 必須啟用 MFA 而還沒設定、或產品要求新增：在互動中開始設定（`input`：簡訊的手機號碼之類）。 */
export const fetchStartMfaEnrollmentSsoInteractionMutation = defineBaseFetcher<
  HttpRequestDTO<StartMfaEnrollmentRequest & { uid: string }>,
  MfaEnrollment
>((http, { params }) =>
  http.request(
    getMfaInteractionControllerStartEnrollmentUrl({ uid: params.uid }),
    jsonBody({ method: params.method, input: params.input }, { method: 'POST' }),
  ),
);
