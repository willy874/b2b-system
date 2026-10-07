import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getMfaPolicyControllerUpdateUrl } from '@/shared/api-sdk';
import type { MfaPolicy, UpdateMfaPolicyRequest } from '@/shared/api-sdk';

/** 修改 MFA 政策（樂觀鎖：帶 `version`，衝突回 409 MFA_POLICY_VERSION_CONFLICT）。 */
export const fetchUpdateMfaPolicyMutation = defineAuthFetcher<
  HttpRequestDTO<UpdateMfaPolicyRequest>,
  MfaPolicy
>((http, { params }) =>
  http.request(getMfaPolicyControllerUpdateUrl(), jsonBody(params, { method: 'PUT' })),
);
