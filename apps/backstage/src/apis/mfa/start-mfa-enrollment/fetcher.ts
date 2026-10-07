import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getMfaSelfControllerStartEnrollmentUrl } from '@/shared/api-sdk';
import type { MfaEnrollment, StartMfaEnrollmentRequest } from '@/shared/api-sdk';

/** 開始設定一種驗證方式（Email 會同時寄出驗證碼）。 */
export const fetchStartMfaEnrollmentMutation = defineAuthFetcher<
  HttpRequestDTO<StartMfaEnrollmentRequest>,
  MfaEnrollment
>((http, { params }) =>
  http.request(getMfaSelfControllerStartEnrollmentUrl(), jsonBody(params, { method: 'POST' })),
);
