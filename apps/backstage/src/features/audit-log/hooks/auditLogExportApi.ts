import type { DataTransferApi } from '@b2b-system/web-core/data-transfer';

import { fetchCancelTransferMutation } from '@/apis/data-transfer/cancel-transfer/fetcher';
import { fetchCreateExportMutation } from '@/apis/data-transfer/create-export/fetcher';
import { fetchTransferReport } from '@/apis/data-transfer/download-transfer-report/fetcher';
import { fetchDownloadTransferMutation } from '@/apis/data-transfer/download-transfer/fetcher';
import { fetchTransferResourcesQuery } from '@/apis/data-transfer/get-transfer-resources/fetcher';
import { getTransferResourcesQueryKeys } from '@/apis/data-transfer/get-transfer-resources/query';
import { fetchTransferRowsQuery } from '@/apis/data-transfer/get-transfer-rows/fetcher';
import { getTransferRowsQueryKeys } from '@/apis/data-transfer/get-transfer-rows/query';
import { fetchTransferQuery } from '@/apis/data-transfer/get-transfer/fetcher';
import { getTransferQueryKeys } from '@/apis/data-transfer/get-transfer/query';

/** 稽核日誌的匯出對話框用的 API（web-core 不呼叫 app 的 API，docs/architecture/backend/22-data-transfer.md §8.1）。 */
export const auditLogExportApi: DataTransferApi = {
  resourcesKey: getTransferResourcesQueryKeys(),
  fetchResources: (signal) => fetchTransferResourcesQuery({ params: undefined, signal }),
  transferKey: getTransferQueryKeys,
  transferRowsKey: getTransferRowsQueryKeys,
  fetchTransfer: (transferId, signal) => fetchTransferQuery({ params: { transferId }, signal }),
  cancel: (transferId, version) => fetchCancelTransferMutation({ params: { transferId, version } }),
  download: (transferId) => fetchDownloadTransferMutation({ params: { transferId } }),
  createExport: (body) => fetchCreateExportMutation({ params: body }),
  fetchRows: (transferId, query, signal) =>
    fetchTransferRowsQuery({ params: { transferId, ...query }, signal }),
  downloadReport: (transferId, query) => fetchTransferReport({ params: { transferId, ...query } }),
};
