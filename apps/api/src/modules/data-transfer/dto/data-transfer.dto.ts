import { z } from 'zod';

import { PaginationSchema, QueryArraySchema } from '@/core/http';
import { defineSchema } from '@/core/validation';

import {
  DATA_TRANSFER_MAX_IDS,
  DATA_TRANSFER_VALIDATE_MAX_ROWS,
  XLSX_MAX_CELL_LENGTH,
} from '../data-transfer.constants';
import {
  EXPORT_FORMATS,
  IMPORT_MODES,
  ROW_OUTCOMES,
  SHEET_FORMATS,
  TRANSFER_DIRECTIONS,
  TRANSFER_STATUSES,
} from '../data-transfer.types';

/** docs/architecture/backend/22-data-transfer.md §4.2 */

export const TransferDirectionSchema = z.enum(TRANSFER_DIRECTIONS);
export const TransferStatusSchema = z.enum(TRANSFER_STATUSES);
export const ImportModeSchema = z.enum(IMPORT_MODES);
export const ExportFormatSchema = z.enum(EXPORT_FORMATS);
export const SheetFormatSchema = z.enum(SHEET_FORMATS);
export const RowOutcomeSchema = z.enum(ROW_OUTCOMES);

const TypeSchema = z.string().trim().min(1).max(50);
const ColumnKeySchema = z.string().trim().min(1).max(100);
/** 一格的原始字串（JSON 中一律是字串，D24）。 */
const CellsSchema = z.record(ColumnKeySchema, z.string().max(XLSX_MAX_CELL_LENGTH));

export const DataTransferSchema = defineSchema(
  'DataTransfer',
  z.object({
    id: z.string().uuid(),
    direction: TransferDirectionSchema,
    type: z.string(),
    mode: ImportModeSchema.nullable(),
    format: ExportFormatSchema,
    status: TransferStatusSchema,
    /** 匯出的範圍種類（勾選或篩選）；匯入是 null。 */
    scopeKind: z.enum(['ids', 'filter']).nullable(),
    columns: z.array(z.string()),
    /** 匯入：原始檔名。 */
    sourceName: z.string().nullable(),
    /** 匯出：檔名與大小（完成後才有）。 */
    outputName: z.string().nullable(),
    outputSize: z.number().int().nullable(),
    /** 匯出：實際寫出的筆數；匯入：送出的列數。 */
    totalRows: z.number().int(),
    processedRows: z.number().int(),
    succeededRows: z.number().int(),
    failedRows: z.number().int(),
    skippedRows: z.number().int(),
    /** 整個傳輸無法進行時的錯誤碼。 */
    errorCode: z.string().nullable(),
    errorDetails: z.record(z.string(), z.unknown()).nullable(),
    /** 樂觀鎖：取消時帶上。 */
    version: z.number().int(),
    expiresAt: z.string(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
);

export const ListDataTransferSchema = PaginationSchema.extend({
  direction: TransferDirectionSchema.optional(),
  type: TypeSchema.optional(),
  status: QueryArraySchema(TransferStatusSchema),
});

export const CancelDataTransferSchema = defineSchema(
  'CancelDataTransferRequest',
  z.object({ version: z.number().int().min(1) }),
);

export const DataTransferDownloadSchema = defineSchema(
  'DataTransferDownload',
  z.object({ url: z.string(), expiresAt: z.string(), fileName: z.string() }),
);

// ── 資源與欄位 ──

export const TransferColumnKindSchema = z.enum([
  'string',
  'number',
  'boolean',
  'date',
  'datetime',
  'enum',
  'reference',
  'json',
]);

export const TransferOptionSchema = defineSchema(
  'DataTransferOption',
  z.object({ value: z.string(), label: z.string() }),
);

export const ExportColumnViewSchema = defineSchema(
  'DataTransferExportColumn',
  z.object({ key: z.string(), label: z.string(), kind: TransferColumnKindSchema }),
);

export const TransferResourceViewSchema = defineSchema(
  'DataTransferResource',
  z.object({
    type: z.string(),
    label: z.string(),
    /** 操作者可以匯出時才有：可選的欄位（只含有權讀的）與格式。 */
    export: z
      .object({
        formats: z.array(ExportFormatSchema),
        columns: z.array(ExportColumnViewSchema),
        orderHint: z.string().nullable(),
      })
      .nullable(),
    /** 操作者可以用的匯入模式（依權限）。 */
    importModes: z.array(ImportModeSchema),
  }),
);

export const TransferResourceListSchema = defineSchema(
  'DataTransferResourceList',
  z.object({ items: z.array(TransferResourceViewSchema) }),
);

export const ImportColumnViewSchema = defineSchema(
  'DataTransferImportColumn',
  z.object({
    key: z.string(),
    label: z.string(),
    kind: TransferColumnKindSchema,
    /** 新增模式必填。 */
    required: z.boolean(),
    multiple: z.boolean(),
    /** 修改模式的比對鍵順序（數字小的先比）；不是比對鍵為 null。 */
    matchKey: z.number().int().nullable(),
    /** 唯一欄：檔案內重複由前端計算（D23）。 */
    unique: z.boolean(),
    /** 修改模式能不能以 `\N` 清空。 */
    nullable: z.boolean(),
    hint: z.string().nullable(),
    /** `enum` 的選項（依請求的語系）。 */
    options: z.array(TransferOptionSchema).nullable(),
    /** 狀態欄的合法轉移（目前值 → 可以改成的值）。 */
    transitions: z.record(z.string(), z.array(z.string())).nullable(),
  }),
);

export const ImportColumnsQuerySchema = z.object({ mode: ImportModeSchema });

export const ImportColumnListSchema = defineSchema(
  'DataTransferImportColumnList',
  z.object({
    items: z.array(ImportColumnViewSchema),
    /** 已知但唯讀的欄位（匯出才有）：預覽頂端列出「以下欄位是唯讀，已忽略」。 */
    readOnly: z.array(z.object({ key: z.string(), label: z.string() })),
  }),
);

export const TemplateQuerySchema = z.object({
  mode: ImportModeSchema,
  format: SheetFormatSchema.default('csv'),
});

export const ReferenceOptionsQuerySchema = z.object({
  keyword: z.string().trim().max(100).default(''),
});

export const ReferenceOptionListSchema = defineSchema(
  'DataTransferReferenceOptionList',
  z.object({ items: z.array(z.object({ id: z.string(), label: z.string() })) }),
);

// ── 匯入：分析、驗證 ──

export const RowIssueSchema = defineSchema(
  'DataTransferRowIssue',
  z.object({
    column: z.string().nullable(),
    code: z.string(),
    params: z.record(z.string(), z.unknown()).optional(),
    severity: z.enum(['error', 'warning']),
  }),
);

export const ImportTargetSchema = defineSchema(
  'DataTransferImportTarget',
  z.object({
    id: z.string(),
    label: z.string(),
    version: z.number().int(),
    /** 檔案中有的欄位的目前值（與 cells 同一種文字表示）。 */
    current: z.record(z.string(), z.string()),
    /** 關聯欄的樂觀鎖輸入，套用時原樣送回。 */
    expected: z.record(z.string(), z.unknown()).optional(),
  }),
);

export const RowValidationSchema = defineSchema(
  'DataTransferRowValidation',
  z.object({
    rowNo: z.number().int(),
    issues: z.array(RowIssueSchema),
    target: ImportTargetSchema.optional(),
    /** 修改模式：與目前值不同的欄位。 */
    changed: z.array(z.string()).optional(),
  }),
);

export const ImportRowSchema = defineSchema(
  'DataTransferImportRow',
  z.object({
    rowNo: z.number().int().min(1),
    sourceRow: z.number().int().nullable(),
    cells: CellsSchema,
  }),
);

/** multipart 的文字欄位（檔案另外以 `file` 收）。 */
export const AnalyzeImportSchema = z.object({
  mode: ImportModeSchema,
  encoding: z.enum(['auto', 'utf-8', 'big5', 'utf-16']).default('auto'),
  sheet: z.string().trim().max(31).optional(),
  /** `{ 來源欄序號: columnKey | null }` 的 JSON 字串。 */
  mapping: z.string().max(20_000).optional(),
});

export const ImportAnalysisSchema = defineSchema(
  'DataTransferImportAnalysis',
  z.discriminatedUnion('status', [
    z.object({
      status: z.literal('needsMapping'),
      fileName: z.string(),
      headers: z.array(
        z.object({ index: z.number().int(), text: z.string(), suggestion: z.string().nullable() }),
      ),
      /** 前 5 列樣本。 */
      samples: z.array(z.array(z.string())),
      /** 不能匯入、會被忽略的標頭（唯讀或沒有權限），對應步驟裡預設「忽略」並註明原因。 */
      ignored: z.array(
        z.object({
          index: z.number().int(),
          header: z.string(),
          reason: z.enum(['readOnly', 'forbidden']),
        }),
      ),
      columns: z.array(ImportColumnViewSchema),
      sheets: z.array(z.string()).optional(),
    }),
    z.object({
      status: z.literal('ok'),
      fileName: z.string(),
      columns: z.array(ImportColumnViewSchema),
      ignored: z.array(
        z.object({ header: z.string(), reason: z.enum(['readOnly', 'forbidden', 'unmapped']) }),
      ),
      rows: z.array(ImportRowSchema),
      /** 與 rows 一一對應。 */
      results: z.array(RowValidationSchema),
      sheets: z.array(z.string()).optional(),
    }),
  ]),
);

export const ValidateImportSchema = defineSchema(
  'ValidateImportRequest',
  z.object({
    mode: ImportModeSchema,
    rows: z
      .array(z.object({ rowNo: z.number().int().min(1), cells: CellsSchema }))
      .min(1)
      .max(DATA_TRANSFER_VALIDATE_MAX_ROWS),
  }),
);

export const ValidateImportResultSchema = defineSchema(
  'ValidateImportResult',
  z.object({ rows: z.array(RowValidationSchema) }),
);

export const CreateImportSchema = defineSchema(
  'CreateImportRequest',
  z.object({
    type: TypeSchema,
    mode: ImportModeSchema,
    fileName: z.string().trim().max(255).optional(),
    /** 有錯誤的列略過（否則整個傳輸在請求當下回 409，或工作重新驗證時該列失敗）。 */
    skipInvalid: z.boolean().default(false),
    rows: z
      .array(
        z.object({
          rowNo: z.number().int().min(1),
          sourceRow: z.number().int().min(1).nullable().optional(),
          cells: CellsSchema,
          /** 修改模式：預覽時比對到的目標（只是樂觀鎖的輸入，不是授權）。 */
          target: z
            .object({
              id: z.string().uuid(),
              version: z.number().int().min(1),
              expected: z.record(z.string(), z.unknown()).optional(),
            })
            .optional(),
        }),
      )
      .min(1)
      // 真正的上限是 feature 參數 `dataTransfer.importMaxRows`（service 檢查）
      .max(20_000),
  }),
);

// ── 匯出 ──

export const CreateExportSchema = defineSchema(
  'CreateExportRequest',
  z.object({
    type: TypeSchema,
    format: ExportFormatSchema.default('csv'),
    scope: z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('ids'),
        ids: z.array(z.string().trim().min(1).max(64)).min(1).max(DATA_TRANSFER_MAX_IDS),
      }),
      z.object({
        kind: z.literal('filter'),
        /** 列表頁送給列表 API 的同一個物件（去掉分頁）；由資源的 `filterSchema` 驗證。 */
        filter: z.record(z.string(), z.unknown()).default({}),
      }),
    ]),
    /** 選填；預設全部有權讀的欄位。 */
    columns: z.array(ColumnKeySchema).min(1).max(100).optional(),
  }),
);

// ── 結果 ──

export const ListTransferRowsSchema = z.object({
  outcome: QueryArraySchema(RowOutcomeSchema),
  afterRowNo: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});

export const TransferApplyRowSchema = defineSchema(
  'DataTransferApplyRow',
  z.object({
    rowNo: z.number().int(),
    sourceRow: z.number().int().nullable(),
    cells: z.record(z.string(), z.string()),
    outcome: RowOutcomeSchema,
    /** `{ code, details }` 或 `{ code: 'VALIDATION_FAILED', issues }`。 */
    error: z.record(z.string(), z.unknown()).nullable(),
    /** 修改模式：實際寫入的原值與新值（文字表示）。 */
    changes: z.record(z.string(), z.tuple([z.string(), z.string()])).nullable(),
    resultId: z.string().nullable(),
  }),
);

export const TransferApplyRowListSchema = defineSchema(
  'DataTransferApplyRowList',
  z.object({ items: z.array(TransferApplyRowSchema), nextRowNo: z.number().int().nullable() }),
);

export const ReportQuerySchema = z.object({
  format: SheetFormatSchema.default('csv'),
  rows: z.enum(['all', 'failed']).default('all'),
});

export type ListDataTransferDto = z.infer<typeof ListDataTransferSchema>;
export type CancelDataTransferDto = z.infer<typeof CancelDataTransferSchema>;
export type CreateExportDto = z.infer<typeof CreateExportSchema>;
export type ImportColumnsQueryDto = z.infer<typeof ImportColumnsQuerySchema>;
export type TemplateQueryDto = z.infer<typeof TemplateQuerySchema>;
export type ReferenceOptionsQueryDto = z.infer<typeof ReferenceOptionsQuerySchema>;
export type AnalyzeImportDto = z.infer<typeof AnalyzeImportSchema>;
export type ValidateImportDto = z.infer<typeof ValidateImportSchema>;
export type CreateImportDto = z.infer<typeof CreateImportSchema>;
export type ListTransferRowsDto = z.infer<typeof ListTransferRowsSchema>;
export type ReportQueryDto = z.infer<typeof ReportQuerySchema>;
export type DataTransferDto = z.infer<typeof DataTransferSchema>;
export type ImportColumnView = z.infer<typeof ImportColumnViewSchema>;
export type RowValidation = z.infer<typeof RowValidationSchema>;
export type ImportAnalysis = z.infer<typeof ImportAnalysisSchema>;
export type TransferApplyRowDto = z.infer<typeof TransferApplyRowSchema>;
