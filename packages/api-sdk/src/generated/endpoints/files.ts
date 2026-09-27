// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：Game Editor API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  CompleteFileUploadRequest,
  CreateFileUploadPartsRequest,
  CreateFileUploadRequest,
  FileListPage,
  FileUpload,
  FileUploadParts,
  FileUploadPolicy,
  StoredFile,
  UpdateFileRequest,
} from '../models';
import { buildUrl, request } from '../runtime';
import type {
  ApiResponse,
  OperationDefinition,
  OperationSchemas,
  RequestOptions,
} from '../runtime';
import {
  CompleteFileUploadRequestSchema,
  CreateFileUploadPartsRequestSchema,
  CreateFileUploadRequestSchema,
  FileListPageSchema,
  FileUploadPartsSchema,
  FileUploadPolicySchema,
  FileUploadSchema,
  StoredFileSchema,
  UpdateFileRequestSchema,
} from '../schemas';

// GET /files

export interface FileControllerListResponses {
  200: {
    data: FileListPage;
  };
}

export type FileControllerListResponse = FileControllerListResponses[200];

export type FileControllerListResult = ApiResponse<200, FileControllerListResponses[200]>;

export const FileControllerListSchemas = {
  responses: {
    200: z.object({
      data: FileListPageSchema,
    }),
  },
} satisfies OperationSchemas;

export function getFileControllerListUrl(): string {
  return buildUrl('/files');
}

const fileControllerListOperation: OperationDefinition = {
  id: 'FileController_list',
  method: 'GET',
  path: '/files',
  responseTypes: { 200: 'json' },
  schemas: FileControllerListSchemas,
};

export function fileControllerList(options?: RequestOptions): Promise<FileControllerListResult> {
  return request<FileControllerListResult>(fileControllerListOperation, {}, options);
}

// POST /files

export type FileControllerCreateUploadBody = CreateFileUploadRequest;

export interface FileControllerCreateUploadInput {
  body: FileControllerCreateUploadBody;
}

export interface FileControllerCreateUploadResponses {
  201: {
    data: FileUpload;
  };
}

export type FileControllerCreateUploadResponse = FileControllerCreateUploadResponses[201];

export type FileControllerCreateUploadResult = ApiResponse<
  201,
  FileControllerCreateUploadResponses[201]
>;

export const FileControllerCreateUploadSchemas = {
  body: CreateFileUploadRequestSchema,
  responses: {
    201: z.object({
      data: FileUploadSchema,
    }),
  },
} satisfies OperationSchemas;

export function getFileControllerCreateUploadUrl(): string {
  return buildUrl('/files');
}

const fileControllerCreateUploadOperation: OperationDefinition = {
  id: 'FileController_createUpload',
  method: 'POST',
  path: '/files',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 201: 'json' },
  schemas: FileControllerCreateUploadSchemas,
};

/** 登記上傳並取得直傳網址（完成後呼叫 complete） */
export function fileControllerCreateUpload(
  input: FileControllerCreateUploadInput,
  options?: RequestOptions,
): Promise<FileControllerCreateUploadResult> {
  return request<FileControllerCreateUploadResult>(
    fileControllerCreateUploadOperation,
    input,
    options,
  );
}

// GET /files/upload-policy

export interface FileControllerGetUploadPolicyResponses {
  200: {
    data: FileUploadPolicy;
  };
}

export type FileControllerGetUploadPolicyResponse = FileControllerGetUploadPolicyResponses[200];

export type FileControllerGetUploadPolicyResult = ApiResponse<
  200,
  FileControllerGetUploadPolicyResponses[200]
>;

export const FileControllerGetUploadPolicySchemas = {
  responses: {
    200: z.object({
      data: FileUploadPolicySchema,
    }),
  },
} satisfies OperationSchemas;

export function getFileControllerGetUploadPolicyUrl(): string {
  return buildUrl('/files/upload-policy');
}

const fileControllerGetUploadPolicyOperation: OperationDefinition = {
  id: 'FileController_getUploadPolicy',
  method: 'GET',
  path: '/files/upload-policy',
  responseTypes: { 200: 'json' },
  schemas: FileControllerGetUploadPolicySchemas,
};

/** 上傳前的檢查與切塊策略（大小上限、分塊門檻、每塊大小） */
export function fileControllerGetUploadPolicy(
  options?: RequestOptions,
): Promise<FileControllerGetUploadPolicyResult> {
  return request<FileControllerGetUploadPolicyResult>(
    fileControllerGetUploadPolicyOperation,
    {},
    options,
  );
}

// POST /files/{id}/parts

export interface FileControllerCreateUploadPartsPathParams {
  id: string;
}

export type FileControllerCreateUploadPartsBody = CreateFileUploadPartsRequest;

export interface FileControllerCreateUploadPartsInput {
  path: FileControllerCreateUploadPartsPathParams;
  body: FileControllerCreateUploadPartsBody;
}

export interface FileControllerCreateUploadPartsResponses {
  200: {
    data: FileUploadParts;
  };
}

export type FileControllerCreateUploadPartsResponse = FileControllerCreateUploadPartsResponses[200];

export type FileControllerCreateUploadPartsResult = ApiResponse<
  200,
  FileControllerCreateUploadPartsResponses[200]
>;

export const FileControllerCreateUploadPartsSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: CreateFileUploadPartsRequestSchema,
  responses: {
    200: z.object({
      data: FileUploadPartsSchema,
    }),
  },
} satisfies OperationSchemas;

export function getFileControllerCreateUploadPartsUrl(
  path: FileControllerCreateUploadPartsPathParams,
): string {
  return buildUrl('/files/{id}/parts', path);
}

const fileControllerCreateUploadPartsOperation: OperationDefinition = {
  id: 'FileController_createUploadParts',
  method: 'POST',
  path: '/files/{id}/parts',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: FileControllerCreateUploadPartsSchemas,
};

/** 分塊上傳：取得指定各塊的直傳網址 */
export function fileControllerCreateUploadParts(
  input: FileControllerCreateUploadPartsInput,
  options?: RequestOptions,
): Promise<FileControllerCreateUploadPartsResult> {
  return request<FileControllerCreateUploadPartsResult>(
    fileControllerCreateUploadPartsOperation,
    input,
    options,
  );
}

// POST /files/{id}/complete

export interface FileControllerCompleteUploadPathParams {
  id: string;
}

export type FileControllerCompleteUploadBody = CompleteFileUploadRequest;

export interface FileControllerCompleteUploadInput {
  path: FileControllerCompleteUploadPathParams;
  body: FileControllerCompleteUploadBody;
}

export interface FileControllerCompleteUploadResponses {
  200: {
    data: StoredFile;
  };
}

export type FileControllerCompleteUploadResponse = FileControllerCompleteUploadResponses[200];

export type FileControllerCompleteUploadResult = ApiResponse<
  200,
  FileControllerCompleteUploadResponses[200]
>;

export const FileControllerCompleteUploadSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: CompleteFileUploadRequestSchema,
  responses: {
    200: z.object({
      data: StoredFileSchema,
    }),
  },
} satisfies OperationSchemas;

export function getFileControllerCompleteUploadUrl(
  path: FileControllerCompleteUploadPathParams,
): string {
  return buildUrl('/files/{id}/complete', path);
}

const fileControllerCompleteUploadOperation: OperationDefinition = {
  id: 'FileController_completeUpload',
  method: 'POST',
  path: '/files/{id}/complete',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: FileControllerCompleteUploadSchemas,
};

/** 確認直傳完成，檔案轉為 ready（分塊上傳要帶各塊的 ETag） */
export function fileControllerCompleteUpload(
  input: FileControllerCompleteUploadInput,
  options?: RequestOptions,
): Promise<FileControllerCompleteUploadResult> {
  return request<FileControllerCompleteUploadResult>(
    fileControllerCompleteUploadOperation,
    input,
    options,
  );
}

// DELETE /files/{id}/upload

export interface FileControllerAbortUploadPathParams {
  id: string;
}

export interface FileControllerAbortUploadInput {
  path: FileControllerAbortUploadPathParams;
}

export interface FileControllerAbortUploadResponses {
  204: undefined;
}

export type FileControllerAbortUploadResponse = FileControllerAbortUploadResponses[204];

export type FileControllerAbortUploadResult = ApiResponse<
  204,
  FileControllerAbortUploadResponses[204]
>;

export const FileControllerAbortUploadSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

export function getFileControllerAbortUploadUrl(path: FileControllerAbortUploadPathParams): string {
  return buildUrl('/files/{id}/upload', path);
}

const fileControllerAbortUploadOperation: OperationDefinition = {
  id: 'FileController_abortUpload',
  method: 'DELETE',
  path: '/files/{id}/upload',
  responseTypes: { 204: 'none' },
  schemas: FileControllerAbortUploadSchemas,
};

/** 放棄上傳中的檔案：清掉已上傳的內容與分塊 */
export function fileControllerAbortUpload(
  input: FileControllerAbortUploadInput,
  options?: RequestOptions,
): Promise<FileControllerAbortUploadResult> {
  return request<FileControllerAbortUploadResult>(
    fileControllerAbortUploadOperation,
    input,
    options,
  );
}

// GET /files/{id}/image/{variant}

export interface FileControllerGetImagePathParams {
  id: string;
  variant: 'original' | 'preview' | 'thumbnail';
}

export interface FileControllerGetImageInput {
  path: FileControllerGetImagePathParams;
}

export interface FileControllerGetImageResponses {
  302: undefined;
}

export type FileControllerGetImageResponse = undefined;

export type FileControllerGetImageResult = ApiResponse<number, undefined>;

export const FileControllerGetImageSchemas = {
  path: z.object({
    id: z.string(),
    variant: z.enum(['original', 'preview', 'thumbnail']),
  }),
} satisfies OperationSchemas;

export function getFileControllerGetImageUrl(path: FileControllerGetImagePathParams): string {
  return buildUrl('/files/{id}/image/{variant}', path);
}

const fileControllerGetImageOperation: OperationDefinition = {
  id: 'FileController_getImage',
  method: 'GET',
  path: '/files/{id}/image/{variant}',
  responseTypes: { 302: 'none' },
  schemas: FileControllerGetImageSchemas,
};

/** 取得圖片的原圖／全螢幕預覽／圖示預覽（302 轉址到物件儲存） */
export function fileControllerGetImage(
  input: FileControllerGetImageInput,
  options?: RequestOptions,
): Promise<FileControllerGetImageResult> {
  return request<FileControllerGetImageResult>(fileControllerGetImageOperation, input, options);
}

// GET /files/{id}

export interface FileControllerFindOnePathParams {
  id: string;
}

export interface FileControllerFindOneInput {
  path: FileControllerFindOnePathParams;
}

export interface FileControllerFindOneResponses {
  200: {
    data: StoredFile;
  };
}

export type FileControllerFindOneResponse = FileControllerFindOneResponses[200];

export type FileControllerFindOneResult = ApiResponse<200, FileControllerFindOneResponses[200]>;

export const FileControllerFindOneSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: StoredFileSchema,
    }),
  },
} satisfies OperationSchemas;

export function getFileControllerFindOneUrl(path: FileControllerFindOnePathParams): string {
  return buildUrl('/files/{id}', path);
}

const fileControllerFindOneOperation: OperationDefinition = {
  id: 'FileController_findOne',
  method: 'GET',
  path: '/files/{id}',
  responseTypes: { 200: 'json' },
  schemas: FileControllerFindOneSchemas,
};

export function fileControllerFindOne(
  input: FileControllerFindOneInput,
  options?: RequestOptions,
): Promise<FileControllerFindOneResult> {
  return request<FileControllerFindOneResult>(fileControllerFindOneOperation, input, options);
}

// DELETE /files/{id}

export interface FileControllerRemovePathParams {
  id: string;
}

export interface FileControllerRemoveInput {
  path: FileControllerRemovePathParams;
}

export interface FileControllerRemoveResponses {
  204: undefined;
}

export type FileControllerRemoveResponse = FileControllerRemoveResponses[204];

export type FileControllerRemoveResult = ApiResponse<204, FileControllerRemoveResponses[204]>;

export const FileControllerRemoveSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

export function getFileControllerRemoveUrl(path: FileControllerRemovePathParams): string {
  return buildUrl('/files/{id}', path);
}

const fileControllerRemoveOperation: OperationDefinition = {
  id: 'FileController_remove',
  method: 'DELETE',
  path: '/files/{id}',
  responseTypes: { 204: 'none' },
  schemas: FileControllerRemoveSchemas,
};

export function fileControllerRemove(
  input: FileControllerRemoveInput,
  options?: RequestOptions,
): Promise<FileControllerRemoveResult> {
  return request<FileControllerRemoveResult>(fileControllerRemoveOperation, input, options);
}

// PATCH /files/{id}

export interface FileControllerUpdatePathParams {
  id: string;
}

export type FileControllerUpdateBody = UpdateFileRequest;

export interface FileControllerUpdateInput {
  path: FileControllerUpdatePathParams;
  body: FileControllerUpdateBody;
}

export interface FileControllerUpdateResponses {
  200: {
    data: StoredFile;
  };
}

export type FileControllerUpdateResponse = FileControllerUpdateResponses[200];

export type FileControllerUpdateResult = ApiResponse<200, FileControllerUpdateResponses[200]>;

export const FileControllerUpdateSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: UpdateFileRequestSchema,
  responses: {
    200: z.object({
      data: StoredFileSchema,
    }),
  },
} satisfies OperationSchemas;

export function getFileControllerUpdateUrl(path: FileControllerUpdatePathParams): string {
  return buildUrl('/files/{id}', path);
}

const fileControllerUpdateOperation: OperationDefinition = {
  id: 'FileController_update',
  method: 'PATCH',
  path: '/files/{id}',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: FileControllerUpdateSchemas,
};

export function fileControllerUpdate(
  input: FileControllerUpdateInput,
  options?: RequestOptions,
): Promise<FileControllerUpdateResult> {
  return request<FileControllerUpdateResult>(fileControllerUpdateOperation, input, options);
}
