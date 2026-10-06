// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  FileControllerAbortUploadInput,
  FileControllerAbortUploadResult,
  FileControllerCompleteUploadInput,
  FileControllerCompleteUploadResult,
  FileControllerCreateUploadInput,
  FileControllerCreateUploadPartsInput,
  FileControllerCreateUploadPartsResult,
  FileControllerCreateUploadResult,
  FileControllerFindOneInput,
  FileControllerFindOneResult,
  FileControllerGetImageInput,
  FileControllerGetImageResult,
  FileControllerGetUploadPolicyResult,
  FileControllerListResult,
  FileControllerMoveInput,
  FileControllerMoveResult,
  FileControllerRemoveInput,
  FileControllerRemoveResult,
  FileControllerRestoreInput,
  FileControllerRestoreResult,
  FileControllerUpdateInput,
  FileControllerUpdateResult,
  FileFolderControllerCreateInput,
  FileFolderControllerCreateResult,
  FileFolderControllerEnsurePathsInput,
  FileFolderControllerEnsurePathsResult,
  FileFolderControllerListResult,
  FileFolderControllerRemoveInput,
  FileFolderControllerRemoveResult,
  FileFolderControllerRenameInput,
  FileFolderControllerRenameResult,
  FileFolderControllerRestoreInput,
  FileFolderControllerRestoreResult,
  FileFolderGrantControllerApproveAccessRequestInput,
  FileFolderGrantControllerApproveAccessRequestResult,
  FileFolderGrantControllerExplainInput,
  FileFolderGrantControllerExplainResult,
  FileFolderGrantControllerListAccessRequestsInput,
  FileFolderGrantControllerListAccessRequestsResult,
  FileFolderGrantControllerListInput,
  FileFolderGrantControllerListResult,
  FileFolderGrantControllerRejectAccessRequestInput,
  FileFolderGrantControllerRejectAccessRequestResult,
  FileFolderGrantControllerRequestAccessInput,
  FileFolderGrantControllerRequestAccessResult,
  FileFolderGrantControllerRevokeInput,
  FileFolderGrantControllerRevokeResult,
  FileFolderGrantControllerSearchSubjectsInput,
  FileFolderGrantControllerSearchSubjectsResult,
  FileFolderGrantControllerSetInheritanceInput,
  FileFolderGrantControllerSetInheritanceResult,
  FileFolderGrantControllerSetInput,
  FileFolderGrantControllerSetResult,
} from '../../endpoints/files';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';
import {
  CompleteFileUploadRequestSchema,
  CreateFileAccessRequestSchema,
  CreateFileFolderRequestSchema,
  CreateFileUploadPartsRequestSchema,
  CreateFileUploadRequestSchema,
  EnsureFileFolderPathsRequestSchema,
  FileAccessExplainSchema,
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
} from '../components';

// GET /files

export const FileControllerListSchemas = {
  responses: {
    200: z.object({
      data: FileListPageSchema,
    }),
  },
} satisfies OperationSchemas;

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

export const FileControllerCreateUploadSchemas = {
  body: CreateFileUploadRequestSchema,
  responses: {
    201: z.object({
      data: FileUploadSchema,
    }),
  },
} satisfies OperationSchemas;

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

export const FileControllerGetUploadPolicySchemas = {
  responses: {
    200: z.object({
      data: FileUploadPolicySchema,
    }),
  },
} satisfies OperationSchemas;

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

export const FileControllerMoveSchemas = {
  body: MoveFileItemsRequestSchema,
  responses: {
    200: z.object({
      data: MoveFileItemsResultSchema,
    }),
  },
} satisfies OperationSchemas;

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

export const FileControllerAbortUploadSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

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

export const FileControllerGetImageSchemas = {
  path: z.object({
    id: z.string(),
    variant: z.enum(['original', 'preview', 'thumbnail']),
  }),
} satisfies OperationSchemas;

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

export const FileControllerRemoveSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

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

export const FileFolderControllerListSchemas = {
  responses: {
    200: z.object({
      data: FileFolderListSchema,
    }),
  },
} satisfies OperationSchemas;

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

export const FileFolderControllerCreateSchemas = {
  body: CreateFileFolderRequestSchema,
  responses: {
    201: z.object({
      data: FileFolderSchema,
    }),
  },
} satisfies OperationSchemas;

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

export const FileFolderControllerEnsurePathsSchemas = {
  body: EnsureFileFolderPathsRequestSchema,
  responses: {
    200: z.object({
      data: FileFolderPathsSchema,
    }),
  },
} satisfies OperationSchemas;

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

export const FileFolderControllerRemoveSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

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

export const FileFolderGrantControllerApproveAccessRequestSchemas = {
  path: z.object({
    id: z.string(),
    requestId: z.string(),
  }),
  body: ReviewFileAccessRequestSchema,
} satisfies OperationSchemas;

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

export const FileFolderGrantControllerRejectAccessRequestSchemas = {
  path: z.object({
    id: z.string(),
    requestId: z.string(),
  }),
  body: ReviewFileAccessRequestSchema,
} satisfies OperationSchemas;

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

export const FileFolderGrantControllerRevokeSchemas = {
  path: z.object({
    id: z.string(),
    subjectId: z.string(),
    subjectType: z.enum(['role', 'user', 'group', 'everyone']),
  }),
} satisfies OperationSchemas;

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

// GET /file-folders/{id}/explain

export const FileFolderGrantControllerExplainSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: FileAccessExplainSchema,
    }),
  },
} satisfies OperationSchemas;

const fileFolderGrantControllerExplainOperation: OperationDefinition = {
  id: 'FileFolderGrantController_explain',
  method: 'GET',
  path: '/file-folders/{id}/explain',
  responseTypes: { 200: 'json' },
  schemas: FileFolderGrantControllerExplainSchemas,
};

/** 使用者在這個資料夾的存取與路徑（自己，或需要 authz:explain） */
export function fileFolderGrantControllerExplain(
  input: FileFolderGrantControllerExplainInput,
  options?: RequestOptions,
): Promise<FileFolderGrantControllerExplainResult> {
  return request<FileFolderGrantControllerExplainResult>(
    fileFolderGrantControllerExplainOperation,
    input,
    options,
  );
}

// GET /file-folders/{id}/grant-subjects

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
