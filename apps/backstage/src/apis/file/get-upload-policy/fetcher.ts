import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getFileControllerGetUploadPolicyUrl } from '@/shared/api-sdk';
import type { FileUploadPolicy } from '@/shared/api-sdk';

export const fetchFileUploadPolicyQuery = defineAuthFetcher<HttpRequestDTO<void>, FileUploadPolicy>(
  (http) => http.request(getFileControllerGetUploadPolicyUrl(), { method: 'GET' }),
);
