import { defineBaseFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getMfaInteractionControllerStartEnrollmentUrl } from '@/shared/api-sdk';
import type { MfaEnrollment, StartMfaEnrollmentRequest } from '@/shared/api-sdk';

/** 必須啟用 MFA 而還沒設定：在互動中開始設定。 */
export const fetchStartMfaEnrollmentSsoInteractionMutation = defineBaseFetcher<
  HttpRequestDTO<StartMfaEnrollmentRequest & { uid: string }>,
  MfaEnrollment
>((http, { params }) =>
  http.request(
    getMfaInteractionControllerStartEnrollmentUrl({ uid: params.uid }),
    jsonBody({ method: params.method }, { method: 'POST' }),
  ),
);
