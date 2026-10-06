// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type {
  CompleteFileUploadRequest,
  CreateFileAccessRequest,
  CreateFileFolderRequest,
  CreateFileUploadPartsRequest,
  CreateFileUploadRequest,
  EnsureFileFolderPathsRequest,
  FileAccessExplain,
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
import type { ApiResponse } from '../runtime';
import { buildUrl } from '../url';

// GET /files

export interface FileControllerListResponses {
  200: {
    data: FileListPage;
  };
}

export type FileControllerListResponse = FileControllerListResponses[200];

export type FileControllerListResult = ApiResponse<200, FileControllerListResponses[200]>;

export function getFileControllerListUrl(): string {
  return buildUrl('/files');
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

export function getFileControllerCreateUploadUrl(): string {
  return buildUrl('/files');
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

export function getFileControllerGetUploadPolicyUrl(): string {
  return buildUrl('/files/upload-policy');
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

export function getFileControllerMoveUrl(): string {
  return buildUrl('/files/move');
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

export function getFileControllerCreateUploadPartsUrl(
  path: FileControllerCreateUploadPartsPathParams,
): string {
  return buildUrl('/files/{id}/parts', path);
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

export function getFileControllerCompleteUploadUrl(
  path: FileControllerCompleteUploadPathParams,
): string {
  return buildUrl('/files/{id}/complete', path);
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

export function getFileControllerAbortUploadUrl(path: FileControllerAbortUploadPathParams): string {
  return buildUrl('/files/{id}/upload', path);
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

export function getFileControllerGetImageUrl(path: FileControllerGetImagePathParams): string {
  return buildUrl('/files/{id}/image/{variant}', path);
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

export function getFileControllerFindOneUrl(path: FileControllerFindOnePathParams): string {
  return buildUrl('/files/{id}', path);
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

export function getFileControllerRemoveUrl(path: FileControllerRemovePathParams): string {
  return buildUrl('/files/{id}', path);
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

export function getFileControllerUpdateUrl(path: FileControllerUpdatePathParams): string {
  return buildUrl('/files/{id}', path);
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

export function getFileControllerRestoreUrl(path: FileControllerRestorePathParams): string {
  return buildUrl('/files/{id}/restore', path);
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

export function getFileFolderControllerListUrl(): string {
  return buildUrl('/file-folders');
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

export function getFileFolderControllerCreateUrl(): string {
  return buildUrl('/file-folders');
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

export function getFileFolderControllerEnsurePathsUrl(): string {
  return buildUrl('/file-folders/paths');
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

export function getFileFolderControllerRemoveUrl(
  path: FileFolderControllerRemovePathParams,
): string {
  return buildUrl('/file-folders/{id}', path);
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

export function getFileFolderControllerRenameUrl(
  path: FileFolderControllerRenamePathParams,
): string {
  return buildUrl('/file-folders/{id}', path);
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

export function getFileFolderControllerRestoreUrl(
  path: FileFolderControllerRestorePathParams,
): string {
  return buildUrl('/file-folders/{id}/restore', path);
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

export function getFileFolderGrantControllerListAccessRequestsUrl(
  path: FileFolderGrantControllerListAccessRequestsPathParams,
): string {
  return buildUrl('/file-folders/{id}/access-requests', path);
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

export function getFileFolderGrantControllerRequestAccessUrl(
  path: FileFolderGrantControllerRequestAccessPathParams,
): string {
  return buildUrl('/file-folders/{id}/access-requests', path);
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

export function getFileFolderGrantControllerApproveAccessRequestUrl(
  path: FileFolderGrantControllerApproveAccessRequestPathParams,
): string {
  return buildUrl('/file-folders/{id}/access-requests/{requestId}/approve', path);
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

export function getFileFolderGrantControllerRejectAccessRequestUrl(
  path: FileFolderGrantControllerRejectAccessRequestPathParams,
): string {
  return buildUrl('/file-folders/{id}/access-requests/{requestId}/reject', path);
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

export function getFileFolderGrantControllerListUrl(
  path: FileFolderGrantControllerListPathParams,
): string {
  return buildUrl('/file-folders/{id}/grants', path);
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

export function getFileFolderGrantControllerSetUrl(
  path: FileFolderGrantControllerSetPathParams,
): string {
  return buildUrl('/file-folders/{id}/grants', path);
}

// DELETE /file-folders/{id}/grants/{subjectType}/{subjectId}

export interface FileFolderGrantControllerRevokePathParams {
  id: string;
  subjectId: string;
  subjectType: 'role' | 'user' | 'group' | 'everyone';
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

export function getFileFolderGrantControllerRevokeUrl(
  path: FileFolderGrantControllerRevokePathParams,
): string {
  return buildUrl('/file-folders/{id}/grants/{subjectType}/{subjectId}', path);
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

export function getFileFolderGrantControllerSetInheritanceUrl(
  path: FileFolderGrantControllerSetInheritancePathParams,
): string {
  return buildUrl('/file-folders/{id}/access', path);
}

// GET /file-folders/{id}/explain

export interface FileFolderGrantControllerExplainPathParams {
  id: string;
}

export interface FileFolderGrantControllerExplainInput {
  path: FileFolderGrantControllerExplainPathParams;
}

export interface FileFolderGrantControllerExplainResponses {
  200: {
    data: FileAccessExplain;
  };
}

export type FileFolderGrantControllerExplainResponse =
  FileFolderGrantControllerExplainResponses[200];

export type FileFolderGrantControllerExplainResult = ApiResponse<
  200,
  FileFolderGrantControllerExplainResponses[200]
>;

export function getFileFolderGrantControllerExplainUrl(
  path: FileFolderGrantControllerExplainPathParams,
): string {
  return buildUrl('/file-folders/{id}/explain', path);
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

export function getFileFolderGrantControllerSearchSubjectsUrl(
  path: FileFolderGrantControllerSearchSubjectsPathParams,
): string {
  return buildUrl('/file-folders/{id}/grant-subjects', path);
}
