import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getMfaSelfControllerRemoveUrl } from '@/shared/api-sdk';
import type { MfaPasswordConfirmRequest } from '@/shared/api-sdk';

/** 移除一個驗證方式（要再輸入密碼）。 */
export const fetchRemoveMfaFactorMutation = defineAuthFetcher<
  HttpRequestDTO<MfaPasswordConfirmRequest & { factorId: string }>,
  { success: boolean }
>((http, { params }) =>
  http.request(
    getMfaSelfControllerRemoveUrl({ id: params.factorId }),
    jsonBody({ password: params.password }, { method: 'DELETE' }),
  ),
);
