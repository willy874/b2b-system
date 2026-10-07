import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getDataTransferControllerFindOneUrl } from '@/shared/api-sdk';
import type { DataTransfer } from '@/shared/api-sdk';

export const fetchTransferQuery = defineAuthFetcher<
  HttpRequestDTO<{ transferId: string }>,
  DataTransfer
>((http, request) =>
  http.request(getDataTransferControllerFindOneUrl({ id: request.params.transferId }), {
    method: 'GET',
  }),
);
