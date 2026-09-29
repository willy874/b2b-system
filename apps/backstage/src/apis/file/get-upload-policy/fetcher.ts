import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getFileControllerGetUploadPolicyUrl } from '@/shared/api-sdk';
import type { FileUploadPolicy } from '@/shared/api-sdk';

import type { InWorkspace } from '../types';

export const fetchFileUploadPolicyQuery = defineAuthFetcher<
  HttpRequestDTO<InWorkspace>,
  FileUploadPolicy
>((http, request) =>
  http.request(getFileControllerGetUploadPolicyUrl({ workspaceId: request.params.workspaceId }), {
    method: 'GET',
  }),
);
