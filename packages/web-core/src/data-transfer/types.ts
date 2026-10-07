import type { QueryKey } from '@tanstack/react-query';

/**
 * 匯入匯出的畫面用的型別（docs/architecture/backend/22-data-transfer.md §4.2）。web-core 不 import app 的 api-sdk：
 * 這裡定義結構相同的型別，app 以 api-sdk 的型別直接傳入（欄位相同即相容）。
 */

export type TransferStatus =
  | 'queued'
  | 'running'
  | 'applying'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired';
export type TransferDirection = 'export' | 'import';
export type ImportMode = 'create' | 'update';
export type ExportFormat = 'csv' | 'xlsx' | 'sql';
export type SheetFormat = 'csv' | 'xlsx';
export type RowOutcome = 'pending' | 'succeeded' | 'failed' | 'skipped' | 'cancelled';
export type TransferColumnKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'enum'
  | 'reference'
  | 'json';

export interface TransferView {
  id: string;
  direction: TransferDirection;
  type: string;
  mode: ImportMode | null;
  format: ExportFormat;
  status: TransferStatus;
  scopeKind: 'ids' | 'filter' | null;
  sourceName: string | null;
  outputName: string | null;
  outputSize: number | null;
  totalRows: number;
  processedRows: number;
  succeededRows: number;
  failedRows: number;
  skippedRows: number;
  errorCode: string | null;
  version: number;
  expiresAt: string;
  finishedAt: string | null;
  createdAt: string;
}

export interface ExportColumnInfo {
  key: string;
  label: string;
  kind: TransferColumnKind;
}

export interface TransferResourceInfo {
  type: string;
  label: string;
  export: { formats: ExportFormat[]; columns: ExportColumnInfo[]; orderHint: string | null } | null;
  importModes: ImportMode[];
}

export interface ImportColumnView {
  key: string;
  label: string;
  kind: TransferColumnKind;
  required: boolean;
  multiple: boolean;
  matchKey: number | null;
  unique: boolean;
  nullable: boolean;
  hint: string | null;
  options: Array<{ value: string; label: string }> | null;
  transitions: Record<string, string[]> | null;
}

export interface RowIssue {
  column: string | null;
  code: string;
  params?: Record<string, unknown>;
  severity: 'error' | 'warning';
}

export interface ImportTarget {
  id: string;
  label: string;
  version: number;
  current: Record<string, string>;
  expected?: Record<string, unknown>;
}

export interface RowValidation {
  rowNo: number;
  issues: RowIssue[];
  target?: ImportTarget;
  changed?: string[];
}

export interface ImportRow {
  rowNo: number;
  sourceRow: number | null;
  cells: Record<string, string>;
}

export type ImportAnalysis =
  | {
      status: 'needsMapping';
      fileName: string;
      headers: Array<{ index: number; text: string; suggestion: string | null }>;
      samples: string[][];
      ignored: Array<{ index: number; header: string; reason: 'readOnly' | 'forbidden' }>;
      columns: ImportColumnView[];
      sheets?: string[];
    }
  | {
      status: 'ok';
      fileName: string;
      columns: ImportColumnView[];
      ignored: Array<{ header: string; reason: 'readOnly' | 'forbidden' | 'unmapped' }>;
      rows: ImportRow[];
      results: RowValidation[];
      sheets?: string[];
    };

export interface ApplyRowView {
  rowNo: number;
  sourceRow: number | null;
  cells: Record<string, string>;
  outcome: RowOutcome;
  error: Record<string, unknown> | null;
  /** 修改模式：`{ 欄位: [原值, 新值] }`。 */
  changes: Record<string, string[]> | null;
  resultId: string | null;
}

export interface AnalyzeOptions {
  mode: ImportMode;
  encoding: 'auto' | 'utf-8' | 'big5' | 'utf-16';
  sheet?: string;
  /** `{ 來源欄序號: columnKey | null }` */
  mapping?: Record<number, string | null>;
}

export interface SubmitImportRow {
  rowNo: number;
  sourceRow?: number | null;
  cells: Record<string, string>;
  target?: { id: string; version: number; expected?: Record<string, unknown> };
}

/** 下載的檔案（範本、結果報告）：經過帶 access token 的 HTTP 管道取得。 */
export interface DownloadedFile {
  blob: Blob;
  fileName: string;
}

/**
 * 匯入匯出用到的 API：由 app 以 `apis/data-transfer/` 的 fetcher 組好傳入（web-core 不呼叫 app 的 API）。
 * 查詢鍵也由 app 給，推播（`Resource.DATA_TRANSFER`）才能以 app 的資源依賴圖讓它們失效。
 */
export interface DataTransferApi {
  resourcesKey: QueryKey;
  fetchResources: (signal: AbortSignal) => Promise<{ items: TransferResourceInfo[] }>;
  transferKey: (id: string) => QueryKey;
  transferRowsKey: (id: string, outcome?: RowOutcome[]) => QueryKey;
  fetchTransfer: (id: string, signal: AbortSignal) => Promise<TransferView>;
  cancel: (id: string, version: number) => Promise<TransferView>;
  download: (id: string) => Promise<{ url: string; fileName: string }>;
  createExport: (body: {
    type: string;
    format: ExportFormat;
    scope: { kind: 'ids'; ids: string[] } | { kind: 'filter'; filter: Record<string, unknown> };
    columns?: string[];
  }) => Promise<TransferView>;
  fetchRows: (
    id: string,
    query: { outcome?: RowOutcome[]; afterRowNo?: number; limit: number },
    signal?: AbortSignal,
  ) => Promise<{ items: ApplyRowView[]; nextRowNo: number | null }>;
  downloadReport: (
    id: string,
    query: { format: SheetFormat; rows: 'all' | 'failed' },
  ) => Promise<DownloadedFile>;
}

export interface ImportApi extends DataTransferApi {
  columnsKey: (type: string, mode: ImportMode) => QueryKey;
  fetchColumns: (
    type: string,
    mode: ImportMode,
    signal: AbortSignal,
  ) => Promise<{ items: ImportColumnView[]; readOnly: Array<{ key: string; label: string }> }>;
  downloadTemplate: (
    type: string,
    mode: ImportMode,
    format: SheetFormat,
  ) => Promise<DownloadedFile>;
  analyze: (type: string, file: File, options: AnalyzeOptions) => Promise<ImportAnalysis>;
  validate: (
    type: string,
    mode: ImportMode,
    rows: Array<{ rowNo: number; cells: Record<string, string> }>,
  ) => Promise<{ rows: RowValidation[] }>;
  searchOptions: (
    type: string,
    column: string,
    keyword: string,
  ) => Promise<Array<{ id: string; label: string }>>;
  createImport: (body: {
    type: string;
    mode: ImportMode;
    fileName?: string;
    skipInvalid: boolean;
    rows: SubmitImportRow[];
  }) => Promise<TransferView>;
}
