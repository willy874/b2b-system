import type { ChipTone } from '@b2b-system/ui/Chip';

import type {
  ExportFormat,
  ImportMode,
  RowOutcome,
  TransferColumnKind,
  TransferDirection,
  TransferStatus,
} from './types';

/** 進行中的狀態：可以取消，畫面要等推播（或輪詢）。 */
export const ACTIVE_TRANSFER_STATUSES: ReadonlySet<TransferStatus> = new Set([
  'queued',
  'running',
  'applying',
]);

/** 推播斷線時的輪詢間隔（docs/architecture/backend/22-data-transfer.md §8.2）。 */
export const TRANSFER_POLL_INTERVAL_MS = 5000;
/** `validate` 一次最多送的列數（與後端一致）。 */
export const VALIDATE_BATCH_SIZE = 1000;
/** 連續的修改合併成一個驗證請求的間隔。 */
export const VALIDATE_DEBOUNCE_MS = 300;
/** 預覽草稿的存檔節流。 */
export const DRAFT_SAVE_THROTTLE_MS = 2000;
/** 復原記錄的編輯次數。 */
export const IMPORT_HISTORY_LIMIT = 50;
/** 「不上傳，直接輸入」建立的空白列數。 */
export const MANUAL_ROW_COUNT = 20;

export const TRANSFER_STATUS_LABEL_KEY = {
  queued: 'dataTransfer.status.queued',
  running: 'dataTransfer.status.running',
  applying: 'dataTransfer.status.applying',
  completed: 'dataTransfer.status.completed',
  failed: 'dataTransfer.status.failed',
  cancelled: 'dataTransfer.status.cancelled',
  expired: 'dataTransfer.status.expired',
} as const satisfies Record<TransferStatus, string>;

export const TRANSFER_STATUS_TONE = {
  queued: 'neutral',
  running: 'brand',
  applying: 'brand',
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
  expired: 'neutral',
} as const satisfies Record<TransferStatus, ChipTone>;

export const TRANSFER_DIRECTION_LABEL_KEY = {
  export: 'dataTransfer.direction.export',
  import: 'dataTransfer.direction.import',
} as const satisfies Record<TransferDirection, string>;

export const IMPORT_MODE_LABEL_KEY = {
  create: 'dataTransfer.mode.create',
  update: 'dataTransfer.mode.update',
} as const satisfies Record<ImportMode, string>;

export const IMPORT_MODE_HINT_KEY = {
  create: 'dataTransfer.modeHint.create',
  update: 'dataTransfer.modeHint.update',
} as const satisfies Record<ImportMode, string>;

export const EXPORT_FORMAT_LABEL_KEY = {
  csv: 'dataTransfer.format.csv',
  xlsx: 'dataTransfer.format.xlsx',
  sql: 'dataTransfer.format.sql',
} as const satisfies Record<ExportFormat, string>;

export const EXPORT_FORMAT_HINT_KEY = {
  csv: 'dataTransfer.formatHint.csv',
  xlsx: 'dataTransfer.formatHint.xlsx',
  sql: 'dataTransfer.formatHint.sql',
} as const satisfies Record<ExportFormat, string>;

export const ROW_OUTCOME_LABEL_KEY = {
  pending: 'dataTransfer.outcome.pending',
  succeeded: 'dataTransfer.outcome.succeeded',
  failed: 'dataTransfer.outcome.failed',
  skipped: 'dataTransfer.outcome.skipped',
  cancelled: 'dataTransfer.outcome.cancelled',
} as const satisfies Record<RowOutcome, string>;

export const ROW_OUTCOME_TONE = {
  pending: 'neutral',
  succeeded: 'success',
  failed: 'danger',
  skipped: 'warning',
  cancelled: 'neutral',
} as const satisfies Record<RowOutcome, ChipTone>;

export const COLUMN_KIND_LABEL_KEY = {
  string: 'dataTransfer.kind.string',
  number: 'dataTransfer.kind.number',
  boolean: 'dataTransfer.kind.boolean',
  date: 'dataTransfer.kind.date',
  datetime: 'dataTransfer.kind.datetime',
  enum: 'dataTransfer.kind.enum',
  reference: 'dataTransfer.kind.reference',
  json: 'dataTransfer.kind.json',
} as const satisfies Record<TransferColumnKind, string>;

/**
 * 問題代碼的訊息（docs/architecture/backend/22-data-transfer.md §9.5）：以「代碼＋參數」存放，只在顯示時翻譯，
 * 切換語系後訊息跟著變。後端新增代碼時加在這裡，沒有翻譯的顯示 `dataTransfer.issue.unknown`。
 */
export const ISSUE_MESSAGE_KEY: Readonly<Record<string, string>> = {
  required: 'dataTransfer.issue.required',
  invalidNumber: 'dataTransfer.issue.invalidNumber',
  invalidBoolean: 'dataTransfer.issue.invalidBoolean',
  invalidDate: 'dataTransfer.issue.invalidDate',
  invalidDateTime: 'dataTransfer.issue.invalidDateTime',
  invalidEnum: 'dataTransfer.issue.invalidEnum',
  tooShort: 'dataTransfer.issue.tooShort',
  tooLong: 'dataTransfer.issue.tooLong',
  tooSmall: 'dataTransfer.issue.tooSmall',
  tooLarge: 'dataTransfer.issue.tooLarge',
  invalidFormat: 'dataTransfer.issue.invalidFormat',
  tooManyValues: 'dataTransfer.issue.tooManyValues',
  notNullable: 'dataTransfer.issue.notNullable',
  formulaWithoutValue: 'dataTransfer.issue.formulaWithoutValue',
  referenceNotFound: 'dataTransfer.issue.referenceNotFound',
  ambiguousReference: 'dataTransfer.issue.ambiguousReference',
  duplicateInFile: 'dataTransfer.issue.duplicateInFile',
  alreadyExists: 'dataTransfer.issue.alreadyExists',
  matchKeyRequired: 'dataTransfer.issue.matchKeyRequired',
  targetNotFound: 'dataTransfer.issue.targetNotFound',
  ambiguousMatch: 'dataTransfer.issue.ambiguousMatch',
  duplicateTarget: 'dataTransfer.issue.duplicateTarget',
  transitionNotAllowed: 'dataTransfer.issue.transitionNotAllowed',
  noChanges: 'dataTransfer.issue.noChanges',
  roleNotAssignable: 'dataTransfer.issue.roleNotAssignable',
  selfModify: 'dataTransfer.issue.selfModify',
};
