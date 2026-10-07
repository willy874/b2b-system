import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getPlatformMfaSelfControllerResendUrl } from '@/shared/api-sdk';
import type { MfaChallengeInfo } from '@/shared/api-sdk';

/** 設定中：重寄驗證碼。 */
export const fetchResendMfaChallengeMutation = defineAuthFetcher<
  HttpRequestDTO<{ factorId: string }>,
  MfaChallengeInfo
>((http, { params }) =>
  http.request(getPlatformMfaSelfControllerResendUrl({ id: params.factorId }), { method: 'POST' }),
);
