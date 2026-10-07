import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getMfaPolicyControllerGetUrl } from '@/shared/api-sdk';
import type { MfaPolicy } from '@/shared/api-sdk';

/** 租戶的 MFA 政策、可選的方式、不符合政策的人數（docs/architecture/backend/21-mfa.md §6）。 */
export const fetchMfaPolicyQuery = defineAuthFetcher<HttpRequestDTO<void>, MfaPolicy>((http) =>
  http.request(getMfaPolicyControllerGetUrl(), { method: 'GET' }),
);
