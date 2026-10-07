import { defineBaseFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getMfaInteractionControllerResendEnrollmentUrl } from '@/shared/api-sdk';
import type { MfaChallengeInfo } from '@/shared/api-sdk';

/** 互動中的設定：重寄驗證碼。 */
export const fetchResendMfaEnrollmentSsoInteractionMutation = defineBaseFetcher<
  HttpRequestDTO<{ uid: string; factorId: string }>,
  MfaChallengeInfo
>((http, { params }) =>
  http.request(
    getMfaInteractionControllerResendEnrollmentUrl({ uid: params.uid, factorId: params.factorId }),
    { method: 'POST' },
  ),
);
