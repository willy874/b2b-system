import type {
  DataTransfer,
  DataTransferApplyRow,
  DataTransferImportAnalysis,
  DataTransferImportColumn,
  DataTransferRowValidation,
} from '@/shared/api-sdk';

export type DataTransferStatus = DataTransfer['status'];
export type ImportMode = NonNullable<DataTransfer['mode']>;
export type ExportFormat = DataTransfer['format'];
/** 結果報告的格式。 */
export type SheetFormat = 'csv' | 'xlsx';
/** 可以匯入的格式，也是範本的格式。 */
export type ImportFormat = 'csv' | 'xlsx' | 'json' | 'yaml';
export type RowOutcome = DataTransferApplyRow['outcome'];
export type ImportColumn = DataTransferImportColumn;
export type ImportAnalysis = DataTransferImportAnalysis;
export type RowValidation = DataTransferRowValidation;

export interface DataTransferListParams {
  offset: number;
  limit: number;
  direction?: DataTransfer['direction'];
  type?: string;
  status?: DataTransferStatus[];
}

/** 範本、結果報告：經過帶 access token 的管道下載的檔案。 */
export interface DownloadedFile {
  blob: Blob;
  fileName: string;
}

/** `Content-Disposition` 的檔名（優先 RFC 5987 的 `filename*`）。 */
export function fileNameOf(headers: Headers, fallback: string): string {
  const disposition = headers.get('content-disposition') ?? '';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  if (encoded) return decodeURIComponent(encoded);
  return /filename="([^"]+)"/i.exec(disposition)?.[1] ?? fallback;
}
