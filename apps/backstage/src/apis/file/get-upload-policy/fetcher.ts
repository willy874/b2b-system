import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getFileControllerGetUploadPolicyUrl } from '@/shared/api-sdk';
import type { FileUploadPolicy } from '@/shared/api-sdk';

export const fetchFileUploadPolicyQuery = defineAuthFetcher<HttpRequestDTO<void>, FileUploadPolicy>(
  (http) => http.request(getFileControllerGetUploadPolicyUrl(), { method: 'GET' }),
);
