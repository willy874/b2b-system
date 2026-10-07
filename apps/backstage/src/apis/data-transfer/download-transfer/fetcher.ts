import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getDataTransferControllerDownloadUrl } from '@/shared/api-sdk';
import type { DataTransferDownload } from '@/shared/api-sdk';

/** 每次重新簽發的下載連結（POST：後端寫稽核）。 */
export const fetchDownloadTransferMutation = defineAuthFetcher<
  HttpRequestDTO<{ transferId: string }>,
  DataTransferDownload
>((http, { params }) =>
  http.request(getDataTransferControllerDownloadUrl({ id: params.transferId }), { method: 'POST' }),
);
