import { defineBaseFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getMfaInteractionControllerChallengeUrl } from '@/shared/api-sdk';
import type { MfaChallengeInfo, MfaLoginChallengeRequest } from '@/shared/api-sdk';

/** 登入的第二步：請伺服器發出驗證碼（Email）。 */
export const fetchChallengeMfaSsoInteractionMutation = defineBaseFetcher<
  HttpRequestDTO<MfaLoginChallengeRequest & { uid: string }>,
  MfaChallengeInfo
>((http, { params }) =>
  http.request(
    getMfaInteractionControllerChallengeUrl({ uid: params.uid }),
    jsonBody({ factorId: params.factorId }, { method: 'POST' }),
  ),
);
