import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getDataTransferControllerCreateImportUrl } from '@/shared/api-sdk';
import type { CreateImportRequest, DataTransfer } from '@/shared/api-sdk';

export const fetchCreateImportMutation = defineAuthFetcher<
  HttpRequestDTO<CreateImportRequest>,
  DataTransfer
>((http, request) =>
  http.request(
    getDataTransferControllerCreateImportUrl(),
    jsonBody(request.params, { method: 'POST' }),
  ),
);
