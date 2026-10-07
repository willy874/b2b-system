import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getDataTransferControllerCancelUrl } from '@/shared/api-sdk';
import type { DataTransfer } from '@/shared/api-sdk';

export const fetchCancelTransferMutation = defineAuthFetcher<
  HttpRequestDTO<{ transferId: string; version: number }>,
  DataTransfer
>((http, { params }) =>
  http.request(
    getDataTransferControllerCancelUrl({ id: params.transferId }),
    jsonBody({ version: params.version }, { method: 'POST' }),
  ),
);
