// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  DataTransferControllerAnalyzeInput,
  DataTransferControllerAnalyzeResult,
  DataTransferControllerCancelInput,
  DataTransferControllerCancelResult,
  DataTransferControllerCreateExportInput,
  DataTransferControllerCreateExportResult,
  DataTransferControllerCreateImportInput,
  DataTransferControllerCreateImportResult,
  DataTransferControllerDownloadInput,
  DataTransferControllerDownloadResult,
  DataTransferControllerFindOneInput,
  DataTransferControllerFindOneResult,
  DataTransferControllerImportColumnsInput,
  DataTransferControllerImportColumnsResult,
  DataTransferControllerListResult,
  DataTransferControllerReferenceOptionsInput,
  DataTransferControllerReferenceOptionsResult,
  DataTransferControllerRemoveInput,
  DataTransferControllerRemoveResult,
  DataTransferControllerReportInput,
  DataTransferControllerReportResult,
  DataTransferControllerResourcesResult,
  DataTransferControllerRowsInput,
  DataTransferControllerRowsResult,
  DataTransferControllerTargetOptionsInput,
  DataTransferControllerTargetOptionsResult,
  DataTransferControllerTemplateInput,
  DataTransferControllerTemplateResult,
  DataTransferControllerValidateInput,
  DataTransferControllerValidateResult,
} from '../../endpoints/data-transfers';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';
import {
  CancelDataTransferRequestSchema,
  CreateExportRequestSchema,
  CreateImportRequestSchema,
  DataTransferApplyRowListSchema,
  DataTransferDownloadSchema,
  DataTransferImportAnalysisSchema,
  DataTransferImportColumnListSchema,
  DataTransferReferenceOptionListSchema,
  DataTransferResourceListSchema,
  DataTransferSchema,
  DataTransferTargetOptionListSchema,
  ValidateImportRequestSchema,
  ValidateImportResultSchema,
} from '../components';

// GET /data-transfers

export const DataTransferControllerListSchemas = {
  responses: {
    200: z.object({
      data: z.object({
        items: z.array(DataTransferSchema),
        pagination: z.object({
          offset: z.int(),
          limit: z.int(),
          total: z.int(),
        }),
      }),
    }),
  },
} satisfies OperationSchemas;

const dataTransferControllerListOperation: OperationDefinition = {
  id: 'DataTransferController_list',
  method: 'GET',
  path: '/data-transfers',
  responseTypes: { 200: 'json' },
  schemas: DataTransferControllerListSchemas,
};

/** 我的匯入匯出 */
export function dataTransferControllerList(
  options?: RequestOptions,
): Promise<DataTransferControllerListResult> {
  return request<DataTransferControllerListResult>(
    dataTransferControllerListOperation,
    {},
    options,
  );
}

// GET /data-transfers/resources

export const DataTransferControllerResourcesSchemas = {
  responses: {
    200: z.object({
      data: DataTransferResourceListSchema,
    }),
  },
} satisfies OperationSchemas;

const dataTransferControllerResourcesOperation: OperationDefinition = {
  id: 'DataTransferController_resources',
  method: 'GET',
  path: '/data-transfers/resources',
  responseTypes: { 200: 'json' },
  schemas: DataTransferControllerResourcesSchemas,
};

/** 操作者可以匯出或匯入的資源類型，以及各自可用的欄位與格式 */
export function dataTransferControllerResources(
  options?: RequestOptions,
): Promise<DataTransferControllerResourcesResult> {
  return request<DataTransferControllerResourcesResult>(
    dataTransferControllerResourcesOperation,
    {},
    options,
  );
}

// POST /data-transfers/exports

export const DataTransferControllerCreateExportSchemas = {
  body: CreateExportRequestSchema,
  responses: {
    202: z.object({
      data: DataTransferSchema,
    }),
  },
} satisfies OperationSchemas;

const dataTransferControllerCreateExportOperation: OperationDefinition = {
  id: 'DataTransferController_createExport',
  method: 'POST',
  path: '/data-transfers/exports',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 202: 'json' },
  schemas: DataTransferControllerCreateExportSchemas,
};

/** 建立匯出：背景組裝檔案，完成後以 POST /:id/download 取得下載連結 */
export function dataTransferControllerCreateExport(
  input: DataTransferControllerCreateExportInput,
  options?: RequestOptions,
): Promise<DataTransferControllerCreateExportResult> {
  return request<DataTransferControllerCreateExportResult>(
    dataTransferControllerCreateExportOperation,
    input,
    options,
  );
}

// POST /data-transfers/imports

export const DataTransferControllerCreateImportSchemas = {
  body: CreateImportRequestSchema,
  responses: {
    202: z.object({
      data: DataTransferSchema,
    }),
  },
} satisfies OperationSchemas;

const dataTransferControllerCreateImportOperation: OperationDefinition = {
  id: 'DataTransferController_createImport',
  method: 'POST',
  path: '/data-transfers/imports',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 202: 'json' },
  schemas: DataTransferControllerCreateImportSchemas,
};

/** 套用匯入：寫入套用列並在背景重新驗證、逐列套用 */
export function dataTransferControllerCreateImport(
  input: DataTransferControllerCreateImportInput,
  options?: RequestOptions,
): Promise<DataTransferControllerCreateImportResult> {
  return request<DataTransferControllerCreateImportResult>(
    dataTransferControllerCreateImportOperation,
    input,
    options,
  );
}

// GET /data-transfers/importers/{type}

export const DataTransferControllerImportColumnsSchemas = {
  path: z.object({
    type: z.string(),
  }),
  responses: {
    200: z.object({
      data: DataTransferImportColumnListSchema,
    }),
  },
} satisfies OperationSchemas;

const dataTransferControllerImportColumnsOperation: OperationDefinition = {
  id: 'DataTransferController_importColumns',
  method: 'GET',
  path: '/data-transfers/importers/{type}',
  responseTypes: { 200: 'json' },
  schemas: DataTransferControllerImportColumnsSchemas,
};

/** 匯入的欄位定義（依請求的語系） */
export function dataTransferControllerImportColumns(
  input: DataTransferControllerImportColumnsInput,
  options?: RequestOptions,
): Promise<DataTransferControllerImportColumnsResult> {
  return request<DataTransferControllerImportColumnsResult>(
    dataTransferControllerImportColumnsOperation,
    input,
    options,
  );
}

// GET /data-transfers/importers/{type}/template

export const DataTransferControllerTemplateSchemas = {
  path: z.object({
    type: z.string(),
  }),
} satisfies OperationSchemas;

const dataTransferControllerTemplateOperation: OperationDefinition = {
  id: 'DataTransferController_template',
  method: 'GET',
  path: '/data-transfers/importers/{type}/template',
  responseTypes: { 200: 'none' },
  schemas: DataTransferControllerTemplateSchemas,
};

/** 下載範本（修改模式預先填入現有資料） */
export function dataTransferControllerTemplate(
  input: DataTransferControllerTemplateInput,
  options?: RequestOptions,
): Promise<DataTransferControllerTemplateResult> {
  return request<DataTransferControllerTemplateResult>(
    dataTransferControllerTemplateOperation,
    input,
    options,
  );
}

// GET /data-transfers/importers/{type}/columns/{key}/options

export const DataTransferControllerReferenceOptionsSchemas = {
  path: z.object({
    type: z.string(),
    key: z.string(),
  }),
  responses: {
    200: z.object({
      data: DataTransferReferenceOptionListSchema,
    }),
  },
} satisfies OperationSchemas;

const dataTransferControllerReferenceOptionsOperation: OperationDefinition = {
  id: 'DataTransferController_referenceOptions',
  method: 'GET',
  path: '/data-transfers/importers/{type}/columns/{key}/options',
  responseTypes: { 200: 'json' },
  schemas: DataTransferControllerReferenceOptionsSchemas,
};

/** 預覽中的選項：reference 欄位的下拉選單，或文字欄的自動完成（欄位有 suggest 時） */
export function dataTransferControllerReferenceOptions(
  input: DataTransferControllerReferenceOptionsInput,
  options?: RequestOptions,
): Promise<DataTransferControllerReferenceOptionsResult> {
  return request<DataTransferControllerReferenceOptionsResult>(
    dataTransferControllerReferenceOptionsOperation,
    input,
    options,
  );
}

// GET /data-transfers/importers/{type}/targets

export const DataTransferControllerTargetOptionsSchemas = {
  path: z.object({
    type: z.string(),
  }),
  responses: {
    200: z.object({
      data: DataTransferTargetOptionListSchema,
    }),
  },
} satisfies OperationSchemas;

const dataTransferControllerTargetOptionsOperation: OperationDefinition = {
  id: 'DataTransferController_targetOptions',
  method: 'GET',
  path: '/data-transfers/importers/{type}/targets',
  responseTypes: { 200: 'json' },
  schemas: DataTransferControllerTargetOptionsSchemas,
};

/** 修改模式：手動指定比對目標的下拉選單（關鍵字搜尋） */
export function dataTransferControllerTargetOptions(
  input: DataTransferControllerTargetOptionsInput,
  options?: RequestOptions,
): Promise<DataTransferControllerTargetOptionsResult> {
  return request<DataTransferControllerTargetOptionsResult>(
    dataTransferControllerTargetOptionsOperation,
    input,
    options,
  );
}

// POST /data-transfers/importers/{type}/analyze

export const DataTransferControllerAnalyzeSchemas = {
  path: z.object({
    type: z.string(),
  }),
  responses: {
    200: z.object({
      data: DataTransferImportAnalysisSchema,
    }),
  },
} satisfies OperationSchemas;

const dataTransferControllerAnalyzeOperation: OperationDefinition = {
  id: 'DataTransferController_analyze',
  method: 'POST',
  path: '/data-transfers/importers/{type}/analyze',
  bodyType: 'form-data',
  contentType: 'multipart/form-data',
  responseTypes: { 200: 'json' },
  schemas: DataTransferControllerAnalyzeSchemas,
};

/** 分析：上傳 CSV／XLSX／JSON／YAML，轉成 JSON 並逐列驗證（不保存任何資料） */
export function dataTransferControllerAnalyze(
  input: DataTransferControllerAnalyzeInput,
  options?: RequestOptions,
): Promise<DataTransferControllerAnalyzeResult> {
  return request<DataTransferControllerAnalyzeResult>(
    dataTransferControllerAnalyzeOperation,
    input,
    options,
  );
}

// POST /data-transfers/importers/{type}/validate

export const DataTransferControllerValidateSchemas = {
  path: z.object({
    type: z.string(),
  }),
  body: ValidateImportRequestSchema,
  responses: {
    200: z.object({
      data: ValidateImportResultSchema,
    }),
  },
} satisfies OperationSchemas;

const dataTransferControllerValidateOperation: OperationDefinition = {
  id: 'DataTransferController_validate',
  method: 'POST',
  path: '/data-transfers/importers/{type}/validate',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: DataTransferControllerValidateSchemas,
};

/** 驗證改過的列（無狀態；最多 1 000 列） */
export function dataTransferControllerValidate(
  input: DataTransferControllerValidateInput,
  options?: RequestOptions,
): Promise<DataTransferControllerValidateResult> {
  return request<DataTransferControllerValidateResult>(
    dataTransferControllerValidateOperation,
    input,
    options,
  );
}

// GET /data-transfers/{id}

export const DataTransferControllerFindOneSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: DataTransferSchema,
    }),
  },
} satisfies OperationSchemas;

const dataTransferControllerFindOneOperation: OperationDefinition = {
  id: 'DataTransferController_findOne',
  method: 'GET',
  path: '/data-transfers/{id}',
  responseTypes: { 200: 'json' },
  schemas: DataTransferControllerFindOneSchemas,
};

export function dataTransferControllerFindOne(
  input: DataTransferControllerFindOneInput,
  options?: RequestOptions,
): Promise<DataTransferControllerFindOneResult> {
  return request<DataTransferControllerFindOneResult>(
    dataTransferControllerFindOneOperation,
    input,
    options,
  );
}

// DELETE /data-transfers/{id}

export const DataTransferControllerRemoveSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

const dataTransferControllerRemoveOperation: OperationDefinition = {
  id: 'DataTransferController_remove',
  method: 'DELETE',
  path: '/data-transfers/{id}',
  responseTypes: { 204: 'none' },
  schemas: DataTransferControllerRemoveSchemas,
};

/** 刪除已結束的傳輸：立即刪除檔案與套用列（不影響任何業務資料） */
export function dataTransferControllerRemove(
  input: DataTransferControllerRemoveInput,
  options?: RequestOptions,
): Promise<DataTransferControllerRemoveResult> {
  return request<DataTransferControllerRemoveResult>(
    dataTransferControllerRemoveOperation,
    input,
    options,
  );
}

// POST /data-transfers/{id}/cancel

export const DataTransferControllerCancelSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: CancelDataTransferRequestSchema,
  responses: {
    200: z.object({
      data: DataTransferSchema,
    }),
  },
} satisfies OperationSchemas;

const dataTransferControllerCancelOperation: OperationDefinition = {
  id: 'DataTransferController_cancel',
  method: 'POST',
  path: '/data-transfers/{id}/cancel',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: DataTransferControllerCancelSchemas,
};

/** 取消進行中的傳輸（帶 version） */
export function dataTransferControllerCancel(
  input: DataTransferControllerCancelInput,
  options?: RequestOptions,
): Promise<DataTransferControllerCancelResult> {
  return request<DataTransferControllerCancelResult>(
    dataTransferControllerCancelOperation,
    input,
    options,
  );
}

// POST /data-transfers/{id}/download

export const DataTransferControllerDownloadSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: DataTransferDownloadSchema,
    }),
  },
} satisfies OperationSchemas;

const dataTransferControllerDownloadOperation: OperationDefinition = {
  id: 'DataTransferController_download',
  method: 'POST',
  path: '/data-transfers/{id}/download',
  responseTypes: { 200: 'json' },
  schemas: DataTransferControllerDownloadSchemas,
};

/** 取得匯出檔的下載連結（每次重新簽發，並重新檢查匯出權限；寫稽核） */
export function dataTransferControllerDownload(
  input: DataTransferControllerDownloadInput,
  options?: RequestOptions,
): Promise<DataTransferControllerDownloadResult> {
  return request<DataTransferControllerDownloadResult>(
    dataTransferControllerDownloadOperation,
    input,
    options,
  );
}

// GET /data-transfers/{id}/rows

export const DataTransferControllerRowsSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: DataTransferApplyRowListSchema,
    }),
  },
} satisfies OperationSchemas;

const dataTransferControllerRowsOperation: OperationDefinition = {
  id: 'DataTransferController_rows',
  method: 'GET',
  path: '/data-transfers/{id}/rows',
  responseTypes: { 200: 'json' },
  schemas: DataTransferControllerRowsSchemas,
};

/** 匯入的套用列與結果（keyset：afterRowNo） */
export function dataTransferControllerRows(
  input: DataTransferControllerRowsInput,
  options?: RequestOptions,
): Promise<DataTransferControllerRowsResult> {
  return request<DataTransferControllerRowsResult>(
    dataTransferControllerRowsOperation,
    input,
    options,
  );
}

// GET /data-transfers/{id}/report

export const DataTransferControllerReportSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

const dataTransferControllerReportOperation: OperationDefinition = {
  id: 'DataTransferController_report',
  method: 'GET',
  path: '/data-transfers/{id}/report',
  responseTypes: { 200: 'none' },
  schemas: DataTransferControllerReportSchemas,
};

/** 下載匯入的結果報告（原本的欄位加上列號、結果、錯誤） */
export function dataTransferControllerReport(
  input: DataTransferControllerReportInput,
  options?: RequestOptions,
): Promise<DataTransferControllerReportResult> {
  return request<DataTransferControllerReportResult>(
    dataTransferControllerReportOperation,
    input,
    options,
  );
}
