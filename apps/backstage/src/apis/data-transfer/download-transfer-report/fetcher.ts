import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getDataTransferControllerReportUrl } from '@/shared/api-sdk';

import { fileNameOf } from '../types';
import type { DownloadedFile, SheetFormat } from '../types';

/** 匯入的結果報告（附件，HTTP 管道回 Blob）。 */
export const fetchTransferReport = defineAuthFetcher<
  HttpRequestDTO<{ transferId: string; format: SheetFormat; rows: 'all' | 'failed' }>,
  DownloadedFile
>(async (http, { params: { transferId, ...query } }) => {
  const response = await http.request<Blob>(
    withQuery(getDataTransferControllerReportUrl({ id: transferId }), { ...query }),
    { method: 'GET' },
  );
  return {
    ...response,
    data: { blob: response.data, fileName: fileNameOf(response.headers, `report.${query.format}`) },
  };
});
