import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getPlatformMfaSelfControllerRegenerateRecoveryCodesUrl } from '@/shared/api-sdk';
import type { MfaPasswordConfirmRequest, MfaRecoveryCodes } from '@/shared/api-sdk';

/** 重新產生備用碼（要再輸入密碼），舊的全部作廢。 */
export const fetchRegenerateMfaRecoveryCodesMutation = defineAuthFetcher<
  HttpRequestDTO<MfaPasswordConfirmRequest>,
  MfaRecoveryCodes
>((http, { params }) =>
  http.request(
    getPlatformMfaSelfControllerRegenerateRecoveryCodesUrl(),
    jsonBody(params, { method: 'POST' }),
  ),
);
