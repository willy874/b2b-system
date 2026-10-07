import type { DataTransferApi, ImportApi } from '@b2b-system/web-core/data-transfer';

import { fetchAnalyzeImport } from '@/apis/data-transfer/analyze-import/fetcher';
import { fetchCancelTransferMutation } from '@/apis/data-transfer/cancel-transfer/fetcher';
import { fetchCreateExportMutation } from '@/apis/data-transfer/create-export/fetcher';
import { fetchCreateImportMutation } from '@/apis/data-transfer/create-import/fetcher';
import { fetchImportTemplate } from '@/apis/data-transfer/download-import-template/fetcher';
import { fetchTransferReport } from '@/apis/data-transfer/download-transfer-report/fetcher';
import { fetchDownloadTransferMutation } from '@/apis/data-transfer/download-transfer/fetcher';
import { fetchImportColumnsQuery } from '@/apis/data-transfer/get-import-columns/fetcher';
import { getImportColumnsQueryKeys } from '@/apis/data-transfer/get-import-columns/query';
import { fetchTransferResourcesQuery } from '@/apis/data-transfer/get-transfer-resources/fetcher';
import { getTransferResourcesQueryKeys } from '@/apis/data-transfer/get-transfer-resources/query';
import { fetchTransferRowsQuery } from '@/apis/data-transfer/get-transfer-rows/fetcher';
import { getTransferRowsQueryKeys } from '@/apis/data-transfer/get-transfer-rows/query';
import { fetchTransferQuery } from '@/apis/data-transfer/get-transfer/fetcher';
import { getTransferQueryKeys } from '@/apis/data-transfer/get-transfer/query';
import { fetchImportOptions } from '@/apis/data-transfer/search-import-options/fetcher';
import { fetchValidateImportRows } from '@/apis/data-transfer/validate-import-rows/fetcher';

/** 匯出對話框用的 API（web-core 不呼叫 app 的 API，docs/architecture/backend/22-data-transfer.md §8.1）。 */
export const userExportApi: DataTransferApi = {
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

/** 匯入頁用的 API。 */
export const userImportApi: ImportApi = {
  ...userExportApi,
  columnsKey: getImportColumnsQueryKeys,
  fetchColumns: (type, mode, signal) => fetchImportColumnsQuery({ params: { type, mode }, signal }),
  downloadTemplate: (type, mode, format) => fetchImportTemplate({ params: { type, mode, format } }),
  analyze: (type, file, options) => fetchAnalyzeImport({ params: { type, file, ...options } }),
  validate: (type, mode, rows) => fetchValidateImportRows({ params: { type, mode, rows } }),
  searchOptions: async (type, column, keyword) =>
    (await fetchImportOptions({ params: { type, column, keyword } })).items,
  createImport: (body) => fetchCreateImportMutation({ params: body }),
};
