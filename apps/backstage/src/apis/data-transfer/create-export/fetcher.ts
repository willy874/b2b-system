import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getDataTransferControllerCreateExportUrl } from '@/shared/api-sdk';
import type { CreateExportRequest, DataTransfer } from '@/shared/api-sdk';

export const fetchCreateExportMutation = defineAuthFetcher<
  HttpRequestDTO<CreateExportRequest>,
  DataTransfer
>((http, request) =>
  http.request(
    getDataTransferControllerCreateExportUrl(),
    jsonBody(request.params, { method: 'POST' }),
  ),
);
