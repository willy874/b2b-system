// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  CompleteFileUploadRequest,
  CreateFileAccessRequest,
  CreateFileFolderRequest,
  CreateFileUploadPartsRequest,
  CreateFileUploadRequest,
  EnsureFileFolderPathsRequest,
  FileAccessRequestList,
  FileAccessRequestSubmitted,
  FileFolder,
  FileFolderGrantList,
  FileFolderList,
  FileFolderPaths,
  FileGrantSubjectList,
  FileListPage,
  FileUpload,
  FileUploadParts,
  FileUploadPolicy,
  MoveFileItemsRequest,
  MoveFileItemsResult,
  RestoredFileFolder,
  ReviewFileAccessRequest,
  SetFileFolderGrantRequest,
  StoredFile,
  UpdateFileFolderAccessRequest,
  UpdateFileFolderRequest,
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
  CreateFileAccessRequestSchema,
  CreateFileFolderRequestSchema,
  CreateFileUploadPartsRequestSchema,
  CreateFileUploadRequestSchema,
  EnsureFileFolderPathsRequestSchema,
  FileAccessRequestListSchema,
  FileAccessRequestSubmittedSchema,
  FileFolderGrantListSchema,
  FileFolderListSchema,
  FileFolderPathsSchema,
  FileFolderSchema,
  FileGrantSubjectListSchema,
  FileListPageSchema,
  FileUploadPartsSchema,
  FileUploadPolicySchema,
  FileUploadSchema,
  MoveFileItemsRequestSchema,
  MoveFileItemsResultSchema,
  RestoredFileFolderSchema,
  ReviewFileAccessRequestSchema,
  SetFileFolderGrantRequestSchema,
  StoredFileSchema,
  UpdateFileFolderAccessRequestSchema,
  UpdateFileFolderRequestSchema,
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

// POST /files/move

export type FileControllerMoveBody = MoveFileItemsRequest;

export interface FileControllerMoveInput {
  body: FileControllerMoveBody;
}

export interface FileControllerMoveResponses {
  200: {
    data: MoveFileItemsResult;
  };
}

export type FileControllerMoveResponse = FileControllerMoveResponses[200];

export type FileControllerMoveResult = ApiResponse<200, FileControllerMoveResponses[200]>;

export const FileControllerMoveSchemas = {
  body: MoveFileItemsRequestSchema,
  responses: {
    200: z.object({
      data: MoveFileItemsResultSchema,
    }),
  },
} satisfies OperationSchemas;

export function getFileControllerMoveUrl(): string {
  return buildUrl('/files/move');
}

const fileControllerMoveOperation: OperationDefinition = {
  id: 'FileController_move',
  method: 'POST',
  path: '/files/move',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: FileControllerMoveSchemas,
};

/** 把檔案與資料夾移到另一個資料夾（targetFolderId 為 null 是根目錄） */
export function fileControllerMove(
  input: FileControllerMoveInput,
  options?: RequestOptions,
): Promise<FileControllerMoveResult> {
  return request<FileControllerMoveResult>(fileControllerMoveOperation, input, options);
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

// POST /files/{id}/restore

export interface FileControllerRestorePathParams {
  id: string;
}

export interface FileControllerRestoreInput {
  path: FileControllerRestorePathParams;
}

export interface FileControllerRestoreResponses {
  200: {
    data: StoredFile;
  };
}

export type FileControllerRestoreResponse = FileControllerRestoreResponses[200];

export type FileControllerRestoreResult = ApiResponse<200, FileControllerRestoreResponses[200]>;

export const FileControllerRestoreSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: StoredFileSchema,
    }),
  },
} satisfies OperationSchemas;

export function getFileControllerRestoreUrl(path: FileControllerRestorePathParams): string {
  return buildUrl('/files/{id}/restore', path);
}

const fileControllerRestoreOperation: OperationDefinition = {
  id: 'FileController_restore',
  method: 'POST',
  path: '/files/{id}/restore',
  responseTypes: { 200: 'json' },
  schemas: FileControllerRestoreSchemas,
};

/** 還原刪除的檔案 */
export function fileControllerRestore(
  input: FileControllerRestoreInput,
  options?: RequestOptions,
): Promise<FileControllerRestoreResult> {
  return request<FileControllerRestoreResult>(fileControllerRestoreOperation, input, options);
}

// GET /file-folders

export interface FileFolderControllerListResponses {
  200: {
    data: FileFolderList;
  };
}

export type FileFolderControllerListResponse = FileFolderControllerListResponses[200];

export type FileFolderControllerListResult = ApiResponse<
  200,
  FileFolderControllerListResponses[200]
>;

export const FileFolderControllerListSchemas = {
  responses: {
    200: z.object({
      data: FileFolderListSchema,
    }),
  },
} satisfies OperationSchemas;

export function getFileFolderControllerListUrl(): string {
  return buildUrl('/file-folders');
}

const fileFolderControllerListOperation: OperationDefinition = {
  id: 'FileFolderController_list',
  method: 'GET',
  path: '/file-folders',
  responseTypes: { 200: 'json' },
  schemas: FileFolderControllerListSchemas,
};

/** 全部的資料夾（扁平清單，前端自行組成樹） */
export function fileFolderControllerList(
  options?: RequestOptions,
): Promise<FileFolderControllerListResult> {
  return request<FileFolderControllerListResult>(fileFolderControllerListOperation, {}, options);
}

// POST /file-folders

export type FileFolderControllerCreateBody = CreateFileFolderRequest;

export interface FileFolderControllerCreateInput {
  body: FileFolderControllerCreateBody;
}

export interface FileFolderControllerCreateResponses {
  201: {
    data: FileFolder;
  };
}

export type FileFolderControllerCreateResponse = FileFolderControllerCreateResponses[201];

export type FileFolderControllerCreateResult = ApiResponse<
  201,
  FileFolderControllerCreateResponses[201]
>;

export const FileFolderControllerCreateSchemas = {
  body: CreateFileFolderRequestSchema,
  responses: {
    201: z.object({
      data: FileFolderSchema,
    }),
  },
} satisfies OperationSchemas;

export function getFileFolderControllerCreateUrl(): string {
  return buildUrl('/file-folders');
}

const fileFolderControllerCreateOperation: OperationDefinition = {
  id: 'FileFolderController_create',
  method: 'POST',
  path: '/file-folders',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 201: 'json' },
  schemas: FileFolderControllerCreateSchemas,
};

export function fileFolderControllerCreate(
  input: FileFolderControllerCreateInput,
  options?: RequestOptions,
): Promise<FileFolderControllerCreateResult> {
  return request<FileFolderControllerCreateResult>(
    fileFolderControllerCreateOperation,
    input,
    options,
  );
}

// POST /file-folders/paths

export type FileFolderControllerEnsurePathsBody = EnsureFileFolderPathsRequest;

export interface FileFolderControllerEnsurePathsInput {
  body: FileFolderControllerEnsurePathsBody;
}

export interface FileFolderControllerEnsurePathsResponses {
  200: {
    data: FileFolderPaths;
  };
}

export type FileFolderControllerEnsurePathsResponse = FileFolderControllerEnsurePathsResponses[200];

export type FileFolderControllerEnsurePathsResult = ApiResponse<
  200,
  FileFolderControllerEnsurePathsResponses[200]
>;

export const FileFolderControllerEnsurePathsSchemas = {
  body: EnsureFileFolderPathsRequestSchema,
  responses: {
    200: z.object({
      data: FileFolderPathsSchema,
    }),
  },
} satisfies OperationSchemas;

export function getFileFolderControllerEnsurePathsUrl(): string {
  return buildUrl('/file-folders/paths');
}

const fileFolderControllerEnsurePathsOperation: OperationDefinition = {
  id: 'FileFolderController_ensurePaths',
  method: 'POST',
  path: '/file-folders/paths',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: FileFolderControllerEnsurePathsSchemas,
};

/** 上傳資料夾：確保各路徑存在（同名的資料夾沿用），回傳各路徑的資料夾 id */
export function fileFolderControllerEnsurePaths(
  input: FileFolderControllerEnsurePathsInput,
  options?: RequestOptions,
): Promise<FileFolderControllerEnsurePathsResult> {
  return request<FileFolderControllerEnsurePathsResult>(
    fileFolderControllerEnsurePathsOperation,
    input,
    options,
  );
}

// DELETE /file-folders/{id}

export interface FileFolderControllerRemovePathParams {
  id: string;
}

export interface FileFolderControllerRemoveInput {
  path: FileFolderControllerRemovePathParams;
}

export interface FileFolderControllerRemoveResponses {
  204: undefined;
}

export type FileFolderControllerRemoveResponse = FileFolderControllerRemoveResponses[204];

export type FileFolderControllerRemoveResult = ApiResponse<
  204,
  FileFolderControllerRemoveResponses[204]
>;

export const FileFolderControllerRemoveSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

export function getFileFolderControllerRemoveUrl(
  path: FileFolderControllerRemovePathParams,
): string {
  return buildUrl('/file-folders/{id}', path);
}

const fileFolderControllerRemoveOperation: OperationDefinition = {
  id: 'FileFolderController_remove',
  method: 'DELETE',
  path: '/file-folders/{id}',
  responseTypes: { 204: 'none' },
  schemas: FileFolderControllerRemoveSchemas,
};

/** 遞迴刪除資料夾：子資料夾與其中的檔案一起刪除 */
export function fileFolderControllerRemove(
  input: FileFolderControllerRemoveInput,
  options?: RequestOptions,
): Promise<FileFolderControllerRemoveResult> {
  return request<FileFolderControllerRemoveResult>(
    fileFolderControllerRemoveOperation,
    input,
    options,
  );
}

// PATCH /file-folders/{id}

export interface FileFolderControllerRenamePathParams {
  id: string;
}

export type FileFolderControllerRenameBody = UpdateFileFolderRequest;

export interface FileFolderControllerRenameInput {
  path: FileFolderControllerRenamePathParams;
  body: FileFolderControllerRenameBody;
}

export interface FileFolderControllerRenameResponses {
  200: {
    data: FileFolder;
  };
}

export type FileFolderControllerRenameResponse = FileFolderControllerRenameResponses[200];

export type FileFolderControllerRenameResult = ApiResponse<
  200,
  FileFolderControllerRenameResponses[200]
>;

export const FileFolderControllerRenameSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: UpdateFileFolderRequestSchema,
  responses: {
    200: z.object({
      data: FileFolderSchema,
    }),
  },
} satisfies OperationSchemas;

export function getFileFolderControllerRenameUrl(
  path: FileFolderControllerRenamePathParams,
): string {
  return buildUrl('/file-folders/{id}', path);
}

const fileFolderControllerRenameOperation: OperationDefinition = {
  id: 'FileFolderController_rename',
  method: 'PATCH',
  path: '/file-folders/{id}',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: FileFolderControllerRenameSchemas,
};

export function fileFolderControllerRename(
  input: FileFolderControllerRenameInput,
  options?: RequestOptions,
): Promise<FileFolderControllerRenameResult> {
  return request<FileFolderControllerRenameResult>(
    fileFolderControllerRenameOperation,
    input,
    options,
  );
}

// POST /file-folders/{id}/restore

export interface FileFolderControllerRestorePathParams {
  id: string;
}

export interface FileFolderControllerRestoreInput {
  path: FileFolderControllerRestorePathParams;
}

export interface FileFolderControllerRestoreResponses {
  200: {
    data: RestoredFileFolder;
  };
}

export type FileFolderControllerRestoreResponse = FileFolderControllerRestoreResponses[200];

export type FileFolderControllerRestoreResult = ApiResponse<
  200,
  FileFolderControllerRestoreResponses[200]
>;

export const FileFolderControllerRestoreSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: RestoredFileFolderSchema,
    }),
  },
} satisfies OperationSchemas;

export function getFileFolderControllerRestoreUrl(
  path: FileFolderControllerRestorePathParams,
): string {
  return buildUrl('/file-folders/{id}/restore', path);
}

const fileFolderControllerRestoreOperation: OperationDefinition = {
  id: 'FileFolderController_restore',
  method: 'POST',
  path: '/file-folders/{id}/restore',
  responseTypes: { 200: 'json' },
  schemas: FileFolderControllerRestoreSchemas,
};

/** 還原刪除的資料夾（同一次刪除的子資料夾與檔案一併還原） */
export function fileFolderControllerRestore(
  input: FileFolderControllerRestoreInput,
  options?: RequestOptions,
): Promise<FileFolderControllerRestoreResult> {
  return request<FileFolderControllerRestoreResult>(
    fileFolderControllerRestoreOperation,
    input,
    options,
  );
}

// GET /file-folders/{id}/access-requests

export interface FileFolderGrantControllerListAccessRequestsPathParams {
  id: string;
}

export interface FileFolderGrantControllerListAccessRequestsInput {
  path: FileFolderGrantControllerListAccessRequestsPathParams;
}

export interface FileFolderGrantControllerListAccessRequestsResponses {
  200: {
    data: FileAccessRequestList;
  };
}

export type FileFolderGrantControllerListAccessRequestsResponse =
  FileFolderGrantControllerListAccessRequestsResponses[200];

export type FileFolderGrantControllerListAccessRequestsResult = ApiResponse<
  200,
  FileFolderGrantControllerListAccessRequestsResponses[200]
>;

export const FileFolderGrantControllerListAccessRequestsSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: FileAccessRequestListSchema,
    }),
  },
} satisfies OperationSchemas;

export function getFileFolderGrantControllerListAccessRequestsUrl(
  path: FileFolderGrantControllerListAccessRequestsPathParams,
): string {
  return buildUrl('/file-folders/{id}/access-requests', path);
}

const fileFolderGrantControllerListAccessRequestsOperation: OperationDefinition = {
  id: 'FileFolderGrantController_listAccessRequests',
  method: 'GET',
  path: '/file-folders/{id}/access-requests',
  responseTypes: { 200: 'json' },
  schemas: FileFolderGrantControllerListAccessRequestsSchemas,
};

/** 這個資料夾的待審存取申請（需要能管理它的授權） */
export function fileFolderGrantControllerListAccessRequests(
  input: FileFolderGrantControllerListAccessRequestsInput,
  options?: RequestOptions,
): Promise<FileFolderGrantControllerListAccessRequestsResult> {
  return request<FileFolderGrantControllerListAccessRequestsResult>(
    fileFolderGrantControllerListAccessRequestsOperation,
    input,
    options,
  );
}

// POST /file-folders/{id}/access-requests

export interface FileFolderGrantControllerRequestAccessPathParams {
  id: string;
}

export type FileFolderGrantControllerRequestAccessBody = CreateFileAccessRequest;

export interface FileFolderGrantControllerRequestAccessInput {
  path: FileFolderGrantControllerRequestAccessPathParams;
  body: FileFolderGrantControllerRequestAccessBody;
}

export interface FileFolderGrantControllerRequestAccessResponses {
  202: {
    data: FileAccessRequestSubmitted;
  };
}

export type FileFolderGrantControllerRequestAccessResponse =
  FileFolderGrantControllerRequestAccessResponses[202];

export type FileFolderGrantControllerRequestAccessResult = ApiResponse<
  202,
  FileFolderGrantControllerRequestAccessResponses[202]
>;

export const FileFolderGrantControllerRequestAccessSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: CreateFileAccessRequestSchema,
  responses: {
    202: z.object({
      data: FileAccessRequestSubmittedSchema,
    }),
  },
} satisfies OperationSchemas;

export function getFileFolderGrantControllerRequestAccessUrl(
  path: FileFolderGrantControllerRequestAccessPathParams,
): string {
  return buildUrl('/file-folders/{id}/access-requests', path);
}

const fileFolderGrantControllerRequestAccessOperation: OperationDefinition = {
  id: 'FileFolderGrantController_requestAccess',
  method: 'POST',
  path: '/file-folders/{id}/access-requests',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 202: 'json' },
  schemas: FileFolderGrantControllerRequestAccessSchemas,
};

/** 申請資料夾存取（審批類型 fileFolder.access） */
export function fileFolderGrantControllerRequestAccess(
  input: FileFolderGrantControllerRequestAccessInput,
  options?: RequestOptions,
): Promise<FileFolderGrantControllerRequestAccessResult> {
  return request<FileFolderGrantControllerRequestAccessResult>(
    fileFolderGrantControllerRequestAccessOperation,
    input,
    options,
  );
}

// POST /file-folders/{id}/access-requests/{requestId}/approve

export interface FileFolderGrantControllerApproveAccessRequestPathParams {
  id: string;
  requestId: string;
}

export type FileFolderGrantControllerApproveAccessRequestBody = ReviewFileAccessRequest;

export interface FileFolderGrantControllerApproveAccessRequestInput {
  path: FileFolderGrantControllerApproveAccessRequestPathParams;
  body: FileFolderGrantControllerApproveAccessRequestBody;
}

export interface FileFolderGrantControllerApproveAccessRequestResponses {
  204: undefined;
}

export type FileFolderGrantControllerApproveAccessRequestResponse =
  FileFolderGrantControllerApproveAccessRequestResponses[204];

export type FileFolderGrantControllerApproveAccessRequestResult = ApiResponse<
  204,
  FileFolderGrantControllerApproveAccessRequestResponses[204]
>;

export const FileFolderGrantControllerApproveAccessRequestSchemas = {
  path: z.object({
    id: z.string(),
    requestId: z.string(),
  }),
  body: ReviewFileAccessRequestSchema,
} satisfies OperationSchemas;

export function getFileFolderGrantControllerApproveAccessRequestUrl(
  path: FileFolderGrantControllerApproveAccessRequestPathParams,
): string {
  return buildUrl('/file-folders/{id}/access-requests/{requestId}/approve', path);
}

const fileFolderGrantControllerApproveAccessRequestOperation: OperationDefinition = {
  id: 'FileFolderGrantController_approveAccessRequest',
  method: 'POST',
  path: '/file-folders/{id}/access-requests/{requestId}/approve',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 204: 'none' },
  schemas: FileFolderGrantControllerApproveAccessRequestSchemas,
};

/** 核准存取申請 ＝ 授予申請的等級（受反提權限制） */
export function fileFolderGrantControllerApproveAccessRequest(
  input: FileFolderGrantControllerApproveAccessRequestInput,
  options?: RequestOptions,
): Promise<FileFolderGrantControllerApproveAccessRequestResult> {
  return request<FileFolderGrantControllerApproveAccessRequestResult>(
    fileFolderGrantControllerApproveAccessRequestOperation,
    input,
    options,
  );
}

// POST /file-folders/{id}/access-requests/{requestId}/reject

export interface FileFolderGrantControllerRejectAccessRequestPathParams {
  id: string;
  requestId: string;
}

export type FileFolderGrantControllerRejectAccessRequestBody = ReviewFileAccessRequest;

export interface FileFolderGrantControllerRejectAccessRequestInput {
  path: FileFolderGrantControllerRejectAccessRequestPathParams;
  body: FileFolderGrantControllerRejectAccessRequestBody;
}

export interface FileFolderGrantControllerRejectAccessRequestResponses {
  204: undefined;
}

export type FileFolderGrantControllerRejectAccessRequestResponse =
  FileFolderGrantControllerRejectAccessRequestResponses[204];

export type FileFolderGrantControllerRejectAccessRequestResult = ApiResponse<
  204,
  FileFolderGrantControllerRejectAccessRequestResponses[204]
>;

export const FileFolderGrantControllerRejectAccessRequestSchemas = {
  path: z.object({
    id: z.string(),
    requestId: z.string(),
  }),
  body: ReviewFileAccessRequestSchema,
} satisfies OperationSchemas;

export function getFileFolderGrantControllerRejectAccessRequestUrl(
  path: FileFolderGrantControllerRejectAccessRequestPathParams,
): string {
  return buildUrl('/file-folders/{id}/access-requests/{requestId}/reject', path);
}

const fileFolderGrantControllerRejectAccessRequestOperation: OperationDefinition = {
  id: 'FileFolderGrantController_rejectAccessRequest',
  method: 'POST',
  path: '/file-folders/{id}/access-requests/{requestId}/reject',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 204: 'none' },
  schemas: FileFolderGrantControllerRejectAccessRequestSchemas,
};

/** 駁回存取申請 */
export function fileFolderGrantControllerRejectAccessRequest(
  input: FileFolderGrantControllerRejectAccessRequestInput,
  options?: RequestOptions,
): Promise<FileFolderGrantControllerRejectAccessRequestResult> {
  return request<FileFolderGrantControllerRejectAccessRequestResult>(
    fileFolderGrantControllerRejectAccessRequestOperation,
    input,
    options,
  );
}

// GET /file-folders/{id}/grants

export interface FileFolderGrantControllerListPathParams {
  id: string;
}

export interface FileFolderGrantControllerListInput {
  path: FileFolderGrantControllerListPathParams;
}

export interface FileFolderGrantControllerListResponses {
  200: {
    data: FileFolderGrantList;
  };
}

export type FileFolderGrantControllerListResponse = FileFolderGrantControllerListResponses[200];

export type FileFolderGrantControllerListResult = ApiResponse<
  200,
  FileFolderGrantControllerListResponses[200]
>;

export const FileFolderGrantControllerListSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: FileFolderGrantListSchema,
    }),
  },
} satisfies OperationSchemas;

export function getFileFolderGrantControllerListUrl(
  path: FileFolderGrantControllerListPathParams,
): string {
  return buildUrl('/file-folders/{id}/grants', path);
}

const fileFolderGrantControllerListOperation: OperationDefinition = {
  id: 'FileFolderGrantController_list',
  method: 'GET',
  path: '/file-folders/{id}/grants',
  responseTypes: { 200: 'json' },
  schemas: FileFolderGrantControllerListSchemas,
};

/** 資料夾的授權：直接授權 ＋ 繼承自上層的（標出來源資料夾） */
export function fileFolderGrantControllerList(
  input: FileFolderGrantControllerListInput,
  options?: RequestOptions,
): Promise<FileFolderGrantControllerListResult> {
  return request<FileFolderGrantControllerListResult>(
    fileFolderGrantControllerListOperation,
    input,
    options,
  );
}

// PUT /file-folders/{id}/grants

export interface FileFolderGrantControllerSetPathParams {
  id: string;
}

export type FileFolderGrantControllerSetBody = SetFileFolderGrantRequest;

export interface FileFolderGrantControllerSetInput {
  path: FileFolderGrantControllerSetPathParams;
  body: FileFolderGrantControllerSetBody;
}

export interface FileFolderGrantControllerSetResponses {
  200: {
    data: FileFolderGrantList;
  };
}

export type FileFolderGrantControllerSetResponse = FileFolderGrantControllerSetResponses[200];

export type FileFolderGrantControllerSetResult = ApiResponse<
  200,
  FileFolderGrantControllerSetResponses[200]
>;

export const FileFolderGrantControllerSetSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: SetFileFolderGrantRequestSchema,
  responses: {
    200: z.object({
      data: FileFolderGrantListSchema,
    }),
  },
} satisfies OperationSchemas;

export function getFileFolderGrantControllerSetUrl(
  path: FileFolderGrantControllerSetPathParams,
): string {
  return buildUrl('/file-folders/{id}/grants', path);
}

const fileFolderGrantControllerSetOperation: OperationDefinition = {
  id: 'FileFolderGrantController_set',
  method: 'PUT',
  path: '/file-folders/{id}/grants',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: FileFolderGrantControllerSetSchemas,
};

/** 新增或變更一筆授權（同一對象只有一筆，變更等級是覆寫） */
export function fileFolderGrantControllerSet(
  input: FileFolderGrantControllerSetInput,
  options?: RequestOptions,
): Promise<FileFolderGrantControllerSetResult> {
  return request<FileFolderGrantControllerSetResult>(
    fileFolderGrantControllerSetOperation,
    input,
    options,
  );
}

// DELETE /file-folders/{id}/grants/{subjectType}/{subjectId}

export interface FileFolderGrantControllerRevokePathParams {
  id: string;
  subjectId: string;
  subjectType: 'role' | 'user' | 'everyone';
}

export interface FileFolderGrantControllerRevokeInput {
  path: FileFolderGrantControllerRevokePathParams;
}

export interface FileFolderGrantControllerRevokeResponses {
  204: undefined;
}

export type FileFolderGrantControllerRevokeResponse = FileFolderGrantControllerRevokeResponses[204];

export type FileFolderGrantControllerRevokeResult = ApiResponse<
  204,
  FileFolderGrantControllerRevokeResponses[204]
>;

export const FileFolderGrantControllerRevokeSchemas = {
  path: z.object({
    id: z.string(),
    subjectId: z.string(),
    subjectType: z.enum(['role', 'user', 'everyone']),
  }),
} satisfies OperationSchemas;

export function getFileFolderGrantControllerRevokeUrl(
  path: FileFolderGrantControllerRevokePathParams,
): string {
  return buildUrl('/file-folders/{id}/grants/{subjectType}/{subjectId}', path);
}

const fileFolderGrantControllerRevokeOperation: OperationDefinition = {
  id: 'FileFolderGrantController_revoke',
  method: 'DELETE',
  path: '/file-folders/{id}/grants/{subjectType}/{subjectId}',
  responseTypes: { 204: 'none' },
  schemas: FileFolderGrantControllerRevokeSchemas,
};

/** 移除一筆直接授權 */
export function fileFolderGrantControllerRevoke(
  input: FileFolderGrantControllerRevokeInput,
  options?: RequestOptions,
): Promise<FileFolderGrantControllerRevokeResult> {
  return request<FileFolderGrantControllerRevokeResult>(
    fileFolderGrantControllerRevokeOperation,
    input,
    options,
  );
}

// PATCH /file-folders/{id}/access

export interface FileFolderGrantControllerSetInheritancePathParams {
  id: string;
}

export type FileFolderGrantControllerSetInheritanceBody = UpdateFileFolderAccessRequest;

export interface FileFolderGrantControllerSetInheritanceInput {
  path: FileFolderGrantControllerSetInheritancePathParams;
  body: FileFolderGrantControllerSetInheritanceBody;
}

export interface FileFolderGrantControllerSetInheritanceResponses {
  200: {
    data: FileFolderGrantList;
  };
}

export type FileFolderGrantControllerSetInheritanceResponse =
  FileFolderGrantControllerSetInheritanceResponses[200];

export type FileFolderGrantControllerSetInheritanceResult = ApiResponse<
  200,
  FileFolderGrantControllerSetInheritanceResponses[200]
>;

export const FileFolderGrantControllerSetInheritanceSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: UpdateFileFolderAccessRequestSchema,
  responses: {
    200: z.object({
      data: FileFolderGrantListSchema,
    }),
  },
} satisfies OperationSchemas;

export function getFileFolderGrantControllerSetInheritanceUrl(
  path: FileFolderGrantControllerSetInheritancePathParams,
): string {
  return buildUrl('/file-folders/{id}/access', path);
}

const fileFolderGrantControllerSetInheritanceOperation: OperationDefinition = {
  id: 'FileFolderGrantController_setInheritance',
  method: 'PATCH',
  path: '/file-folders/{id}/access',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: FileFolderGrantControllerSetInheritanceSchemas,
};

/** 中斷／恢復繼承（中斷時複製目前繼承到的授權） */
export function fileFolderGrantControllerSetInheritance(
  input: FileFolderGrantControllerSetInheritanceInput,
  options?: RequestOptions,
): Promise<FileFolderGrantControllerSetInheritanceResult> {
  return request<FileFolderGrantControllerSetInheritanceResult>(
    fileFolderGrantControllerSetInheritanceOperation,
    input,
    options,
  );
}

// GET /file-folders/{id}/grant-subjects

export interface FileFolderGrantControllerSearchSubjectsPathParams {
  id: string;
}

export interface FileFolderGrantControllerSearchSubjectsInput {
  path: FileFolderGrantControllerSearchSubjectsPathParams;
}

export interface FileFolderGrantControllerSearchSubjectsResponses {
  200: {
    data: FileGrantSubjectList;
  };
}

export type FileFolderGrantControllerSearchSubjectsResponse =
  FileFolderGrantControllerSearchSubjectsResponses[200];

export type FileFolderGrantControllerSearchSubjectsResult = ApiResponse<
  200,
  FileFolderGrantControllerSearchSubjectsResponses[200]
>;

export const FileFolderGrantControllerSearchSubjectsSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: FileGrantSubjectListSchema,
    }),
  },
} satisfies OperationSchemas;

export function getFileFolderGrantControllerSearchSubjectsUrl(
  path: FileFolderGrantControllerSearchSubjectsPathParams,
): string {
  return buildUrl('/file-folders/{id}/grant-subjects', path);
}

const fileFolderGrantControllerSearchSubjectsOperation: OperationDefinition = {
  id: 'FileFolderGrantController_searchSubjects',
  method: 'GET',
  path: '/file-folders/{id}/grant-subjects',
  responseTypes: { 200: 'json' },
  schemas: FileFolderGrantControllerSearchSubjectsSchemas,
};

/** 授權對象的候選清單（只回 id 與名稱） */
export function fileFolderGrantControllerSearchSubjects(
  input: FileFolderGrantControllerSearchSubjectsInput,
  options?: RequestOptions,
): Promise<FileFolderGrantControllerSearchSubjectsResult> {
  return request<FileFolderGrantControllerSearchSubjectsResult>(
    fileFolderGrantControllerSearchSubjectsOperation,
    input,
    options,
  );
}
