// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type {
  CancelDataTransferRequest,
  CreateExportRequest,
  CreateImportRequest,
  DataTransfer,
  DataTransferApplyRowList,
  DataTransferDownload,
  DataTransferImportAnalysis,
  DataTransferImportColumnList,
  DataTransferReferenceOptionList,
  DataTransferResourceList,
  ValidateImportRequest,
  ValidateImportResult,
} from '../models';
import type { ApiResponse } from '../runtime';
import { buildUrl } from '../url';

// GET /data-transfers

export interface DataTransferControllerListResponses {
  200: {
    data: {
      items: Array<DataTransfer>;
      pagination: {
        offset: number;
        limit: number;
        total: number;
      };
    };
  };
}

export type DataTransferControllerListResponse = DataTransferControllerListResponses[200];

export type DataTransferControllerListResult = ApiResponse<
  200,
  DataTransferControllerListResponses[200]
>;

export function getDataTransferControllerListUrl(): string {
  return buildUrl('/data-transfers');
}

// GET /data-transfers/resources

export interface DataTransferControllerResourcesResponses {
  200: {
    data: DataTransferResourceList;
  };
}

export type DataTransferControllerResourcesResponse = DataTransferControllerResourcesResponses[200];

export type DataTransferControllerResourcesResult = ApiResponse<
  200,
  DataTransferControllerResourcesResponses[200]
>;

export function getDataTransferControllerResourcesUrl(): string {
  return buildUrl('/data-transfers/resources');
}

// POST /data-transfers/exports

export type DataTransferControllerCreateExportBody = CreateExportRequest;

export interface DataTransferControllerCreateExportInput {
  body: DataTransferControllerCreateExportBody;
}

export interface DataTransferControllerCreateExportResponses {
  202: {
    data: DataTransfer;
  };
}

export type DataTransferControllerCreateExportResponse =
  DataTransferControllerCreateExportResponses[202];

export type DataTransferControllerCreateExportResult = ApiResponse<
  202,
  DataTransferControllerCreateExportResponses[202]
>;

export function getDataTransferControllerCreateExportUrl(): string {
  return buildUrl('/data-transfers/exports');
}

// POST /data-transfers/imports

export type DataTransferControllerCreateImportBody = CreateImportRequest;

export interface DataTransferControllerCreateImportInput {
  body: DataTransferControllerCreateImportBody;
}

export interface DataTransferControllerCreateImportResponses {
  202: {
    data: DataTransfer;
  };
}

export type DataTransferControllerCreateImportResponse =
  DataTransferControllerCreateImportResponses[202];

export type DataTransferControllerCreateImportResult = ApiResponse<
  202,
  DataTransferControllerCreateImportResponses[202]
>;

export function getDataTransferControllerCreateImportUrl(): string {
  return buildUrl('/data-transfers/imports');
}

// GET /data-transfers/importers/{type}

export interface DataTransferControllerImportColumnsPathParams {
  type: string;
}

export interface DataTransferControllerImportColumnsInput {
  path: DataTransferControllerImportColumnsPathParams;
}

export interface DataTransferControllerImportColumnsResponses {
  200: {
    data: DataTransferImportColumnList;
  };
}

export type DataTransferControllerImportColumnsResponse =
  DataTransferControllerImportColumnsResponses[200];

export type DataTransferControllerImportColumnsResult = ApiResponse<
  200,
  DataTransferControllerImportColumnsResponses[200]
>;

export function getDataTransferControllerImportColumnsUrl(
  path: DataTransferControllerImportColumnsPathParams,
): string {
  return buildUrl('/data-transfers/importers/{type}', path);
}

// GET /data-transfers/importers/{type}/template

export interface DataTransferControllerTemplatePathParams {
  type: string;
}

export interface DataTransferControllerTemplateInput {
  path: DataTransferControllerTemplatePathParams;
}

export interface DataTransferControllerTemplateResponses {
  200: undefined;
}

export type DataTransferControllerTemplateResponse = DataTransferControllerTemplateResponses[200];

export type DataTransferControllerTemplateResult = ApiResponse<
  200,
  DataTransferControllerTemplateResponses[200]
>;

export function getDataTransferControllerTemplateUrl(
  path: DataTransferControllerTemplatePathParams,
): string {
  return buildUrl('/data-transfers/importers/{type}/template', path);
}

// GET /data-transfers/importers/{type}/columns/{key}/options

export interface DataTransferControllerReferenceOptionsPathParams {
  type: string;
  key: string;
}

export interface DataTransferControllerReferenceOptionsInput {
  path: DataTransferControllerReferenceOptionsPathParams;
}

export interface DataTransferControllerReferenceOptionsResponses {
  200: {
    data: DataTransferReferenceOptionList;
  };
}

export type DataTransferControllerReferenceOptionsResponse =
  DataTransferControllerReferenceOptionsResponses[200];

export type DataTransferControllerReferenceOptionsResult = ApiResponse<
  200,
  DataTransferControllerReferenceOptionsResponses[200]
>;

export function getDataTransferControllerReferenceOptionsUrl(
  path: DataTransferControllerReferenceOptionsPathParams,
): string {
  return buildUrl('/data-transfers/importers/{type}/columns/{key}/options', path);
}

// POST /data-transfers/importers/{type}/analyze

export interface DataTransferControllerAnalyzePathParams {
  type: string;
}

export type DataTransferControllerAnalyzeBody =
  | FormData
  | {
      file: Blob;
      mode: 'create' | 'update';
      encoding?: 'auto' | 'utf-8' | 'big5' | 'utf-16';
      sheet?: string;
      /** `{ 來源欄序號: columnKey | null }` 的 JSON 字串 */
      mapping?: string;
    };

export interface DataTransferControllerAnalyzeInput {
  path: DataTransferControllerAnalyzePathParams;
  body: DataTransferControllerAnalyzeBody;
}

export interface DataTransferControllerAnalyzeResponses {
  200: {
    data: DataTransferImportAnalysis;
  };
}

export type DataTransferControllerAnalyzeResponse = DataTransferControllerAnalyzeResponses[200];

export type DataTransferControllerAnalyzeResult = ApiResponse<
  200,
  DataTransferControllerAnalyzeResponses[200]
>;

export function getDataTransferControllerAnalyzeUrl(
  path: DataTransferControllerAnalyzePathParams,
): string {
  return buildUrl('/data-transfers/importers/{type}/analyze', path);
}

// POST /data-transfers/importers/{type}/validate

export interface DataTransferControllerValidatePathParams {
  type: string;
}

export type DataTransferControllerValidateBody = ValidateImportRequest;

export interface DataTransferControllerValidateInput {
  path: DataTransferControllerValidatePathParams;
  body: DataTransferControllerValidateBody;
}

export interface DataTransferControllerValidateResponses {
  200: {
    data: ValidateImportResult;
  };
}

export type DataTransferControllerValidateResponse = DataTransferControllerValidateResponses[200];

export type DataTransferControllerValidateResult = ApiResponse<
  200,
  DataTransferControllerValidateResponses[200]
>;

export function getDataTransferControllerValidateUrl(
  path: DataTransferControllerValidatePathParams,
): string {
  return buildUrl('/data-transfers/importers/{type}/validate', path);
}

// GET /data-transfers/{id}

export interface DataTransferControllerFindOnePathParams {
  id: string;
}

export interface DataTransferControllerFindOneInput {
  path: DataTransferControllerFindOnePathParams;
}

export interface DataTransferControllerFindOneResponses {
  200: {
    data: DataTransfer;
  };
}

export type DataTransferControllerFindOneResponse = DataTransferControllerFindOneResponses[200];

export type DataTransferControllerFindOneResult = ApiResponse<
  200,
  DataTransferControllerFindOneResponses[200]
>;

export function getDataTransferControllerFindOneUrl(
  path: DataTransferControllerFindOnePathParams,
): string {
  return buildUrl('/data-transfers/{id}', path);
}

// DELETE /data-transfers/{id}

export interface DataTransferControllerRemovePathParams {
  id: string;
}

export interface DataTransferControllerRemoveInput {
  path: DataTransferControllerRemovePathParams;
}

export interface DataTransferControllerRemoveResponses {
  204: undefined;
}

export type DataTransferControllerRemoveResponse = DataTransferControllerRemoveResponses[204];

export type DataTransferControllerRemoveResult = ApiResponse<
  204,
  DataTransferControllerRemoveResponses[204]
>;

export function getDataTransferControllerRemoveUrl(
  path: DataTransferControllerRemovePathParams,
): string {
  return buildUrl('/data-transfers/{id}', path);
}

// POST /data-transfers/{id}/cancel

export interface DataTransferControllerCancelPathParams {
  id: string;
}

export type DataTransferControllerCancelBody = CancelDataTransferRequest;

export interface DataTransferControllerCancelInput {
  path: DataTransferControllerCancelPathParams;
  body: DataTransferControllerCancelBody;
}

export interface DataTransferControllerCancelResponses {
  200: {
    data: DataTransfer;
  };
}

export type DataTransferControllerCancelResponse = DataTransferControllerCancelResponses[200];

export type DataTransferControllerCancelResult = ApiResponse<
  200,
  DataTransferControllerCancelResponses[200]
>;

export function getDataTransferControllerCancelUrl(
  path: DataTransferControllerCancelPathParams,
): string {
  return buildUrl('/data-transfers/{id}/cancel', path);
}

// POST /data-transfers/{id}/download

export interface DataTransferControllerDownloadPathParams {
  id: string;
}

export interface DataTransferControllerDownloadInput {
  path: DataTransferControllerDownloadPathParams;
}

export interface DataTransferControllerDownloadResponses {
  200: {
    data: DataTransferDownload;
  };
}

export type DataTransferControllerDownloadResponse = DataTransferControllerDownloadResponses[200];

export type DataTransferControllerDownloadResult = ApiResponse<
  200,
  DataTransferControllerDownloadResponses[200]
>;

export function getDataTransferControllerDownloadUrl(
  path: DataTransferControllerDownloadPathParams,
): string {
  return buildUrl('/data-transfers/{id}/download', path);
}

// GET /data-transfers/{id}/rows

export interface DataTransferControllerRowsPathParams {
  id: string;
}

export interface DataTransferControllerRowsInput {
  path: DataTransferControllerRowsPathParams;
}

export interface DataTransferControllerRowsResponses {
  200: {
    data: DataTransferApplyRowList;
  };
}

export type DataTransferControllerRowsResponse = DataTransferControllerRowsResponses[200];

export type DataTransferControllerRowsResult = ApiResponse<
  200,
  DataTransferControllerRowsResponses[200]
>;

export function getDataTransferControllerRowsUrl(
  path: DataTransferControllerRowsPathParams,
): string {
  return buildUrl('/data-transfers/{id}/rows', path);
}

// GET /data-transfers/{id}/report

export interface DataTransferControllerReportPathParams {
  id: string;
}

export interface DataTransferControllerReportInput {
  path: DataTransferControllerReportPathParams;
}

export interface DataTransferControllerReportResponses {
  200: undefined;
}

export type DataTransferControllerReportResponse = DataTransferControllerReportResponses[200];

export type DataTransferControllerReportResult = ApiResponse<
  200,
  DataTransferControllerReportResponses[200]
>;

export function getDataTransferControllerReportUrl(
  path: DataTransferControllerReportPathParams,
): string {
  return buildUrl('/data-transfers/{id}/report', path);
}
