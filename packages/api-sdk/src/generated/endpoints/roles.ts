// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type {
  CreateRoleRequest,
  DuplicateRoleRequest,
  RestoredRole,
  RevertRoleRevisionRequest,
  RevisionSummary,
  Role,
  RoleHolder,
  RolePermissions,
  RoleRevision,
  UpdateRolePermissionsRequest,
  UpdateRoleRequest,
} from '../models';
import type { ApiResponse } from '../runtime';
import { buildUrl } from '../url';

// GET /roles

export interface RoleControllerListResponses {
  200: {
    data: {
      items: Array<Role>;
      pagination: {
        offset: number;
        limit: number;
        total: number;
      };
    };
  };
}

export type RoleControllerListResponse = RoleControllerListResponses[200];

export type RoleControllerListResult = ApiResponse<200, RoleControllerListResponses[200]>;

export function getRoleControllerListUrl(): string {
  return buildUrl('/roles');
}

// POST /roles

export type RoleControllerCreateBody = CreateRoleRequest;

export interface RoleControllerCreateInput {
  body: RoleControllerCreateBody;
}

export interface RoleControllerCreateResponses {
  201: {
    data: Role;
  };
}

export type RoleControllerCreateResponse = RoleControllerCreateResponses[201];

export type RoleControllerCreateResult = ApiResponse<201, RoleControllerCreateResponses[201]>;

export function getRoleControllerCreateUrl(): string {
  return buildUrl('/roles');
}

// GET /roles/{id}

export interface RoleControllerFindOnePathParams {
  id: string;
}

export interface RoleControllerFindOneInput {
  path: RoleControllerFindOnePathParams;
}

export interface RoleControllerFindOneResponses {
  200: {
    data: Role;
  };
}

export type RoleControllerFindOneResponse = RoleControllerFindOneResponses[200];

export type RoleControllerFindOneResult = ApiResponse<200, RoleControllerFindOneResponses[200]>;

export function getRoleControllerFindOneUrl(path: RoleControllerFindOnePathParams): string {
  return buildUrl('/roles/{id}', path);
}

// DELETE /roles/{id}

export interface RoleControllerRemovePathParams {
  id: string;
}

export interface RoleControllerRemoveInput {
  path: RoleControllerRemovePathParams;
}

export interface RoleControllerRemoveResponses {
  204: undefined;
}

export type RoleControllerRemoveResponse = RoleControllerRemoveResponses[204];

export type RoleControllerRemoveResult = ApiResponse<204, RoleControllerRemoveResponses[204]>;

export function getRoleControllerRemoveUrl(path: RoleControllerRemovePathParams): string {
  return buildUrl('/roles/{id}', path);
}

// PATCH /roles/{id}

export interface RoleControllerUpdatePathParams {
  id: string;
}

export type RoleControllerUpdateBody = UpdateRoleRequest;

export interface RoleControllerUpdateInput {
  path: RoleControllerUpdatePathParams;
  body: RoleControllerUpdateBody;
}

export interface RoleControllerUpdateResponses {
  200: {
    data: Role;
  };
}

export type RoleControllerUpdateResponse = RoleControllerUpdateResponses[200];

export type RoleControllerUpdateResult = ApiResponse<200, RoleControllerUpdateResponses[200]>;

export function getRoleControllerUpdateUrl(path: RoleControllerUpdatePathParams): string {
  return buildUrl('/roles/{id}', path);
}

// POST /roles/{id}/restore

export interface RoleControllerRestorePathParams {
  id: string;
}

export interface RoleControllerRestoreInput {
  path: RoleControllerRestorePathParams;
}

export interface RoleControllerRestoreResponses {
  200: {
    data: RestoredRole;
  };
}

export type RoleControllerRestoreResponse = RoleControllerRestoreResponses[200];

export type RoleControllerRestoreResult = ApiResponse<200, RoleControllerRestoreResponses[200]>;

export function getRoleControllerRestoreUrl(path: RoleControllerRestorePathParams): string {
  return buildUrl('/roles/{id}/restore', path);
}

// GET /roles/{id}/revisions

export interface RoleControllerListRevisionsPathParams {
  id: string;
}

export interface RoleControllerListRevisionsInput {
  path: RoleControllerListRevisionsPathParams;
}

export interface RoleControllerListRevisionsResponses {
  200: {
    data: {
      items: Array<RevisionSummary>;
      pagination: {
        offset: number;
        limit: number;
        total: number;
      };
    };
  };
}

export type RoleControllerListRevisionsResponse = RoleControllerListRevisionsResponses[200];

export type RoleControllerListRevisionsResult = ApiResponse<
  200,
  RoleControllerListRevisionsResponses[200]
>;

export function getRoleControllerListRevisionsUrl(
  path: RoleControllerListRevisionsPathParams,
): string {
  return buildUrl('/roles/{id}/revisions', path);
}

// GET /roles/{id}/revisions/{version}

export interface RoleControllerGetRevisionPathParams {
  id: string;
  version: number;
}

export interface RoleControllerGetRevisionInput {
  path: RoleControllerGetRevisionPathParams;
}

export interface RoleControllerGetRevisionResponses {
  200: {
    data: RoleRevision;
  };
}

export type RoleControllerGetRevisionResponse = RoleControllerGetRevisionResponses[200];

export type RoleControllerGetRevisionResult = ApiResponse<
  200,
  RoleControllerGetRevisionResponses[200]
>;

export function getRoleControllerGetRevisionUrl(path: RoleControllerGetRevisionPathParams): string {
  return buildUrl('/roles/{id}/revisions/{version}', path);
}

// POST /roles/{id}/revisions/{version}/revert

export interface RoleControllerRevertToRevisionPathParams {
  id: string;
  version: number;
}

export type RoleControllerRevertToRevisionBody = RevertRoleRevisionRequest;

export interface RoleControllerRevertToRevisionInput {
  path: RoleControllerRevertToRevisionPathParams;
  body: RoleControllerRevertToRevisionBody;
}

export interface RoleControllerRevertToRevisionResponses {
  200: {
    data: Role;
  };
}

export type RoleControllerRevertToRevisionResponse = RoleControllerRevertToRevisionResponses[200];

export type RoleControllerRevertToRevisionResult = ApiResponse<
  200,
  RoleControllerRevertToRevisionResponses[200]
>;

export function getRoleControllerRevertToRevisionUrl(
  path: RoleControllerRevertToRevisionPathParams,
): string {
  return buildUrl('/roles/{id}/revisions/{version}/revert', path);
}

// GET /roles/{id}/permissions

export interface RoleControllerListPermissionsPathParams {
  id: string;
}

export interface RoleControllerListPermissionsInput {
  path: RoleControllerListPermissionsPathParams;
}

export interface RoleControllerListPermissionsResponses {
  200: {
    data: RolePermissions;
  };
}

export type RoleControllerListPermissionsResponse = RoleControllerListPermissionsResponses[200];

export type RoleControllerListPermissionsResult = ApiResponse<
  200,
  RoleControllerListPermissionsResponses[200]
>;

export function getRoleControllerListPermissionsUrl(
  path: RoleControllerListPermissionsPathParams,
): string {
  return buildUrl('/roles/{id}/permissions', path);
}

// PATCH /roles/{id}/permissions

export interface RoleControllerUpdatePermissionsPathParams {
  id: string;
}

export type RoleControllerUpdatePermissionsBody = UpdateRolePermissionsRequest;

export interface RoleControllerUpdatePermissionsInput {
  path: RoleControllerUpdatePermissionsPathParams;
  body: RoleControllerUpdatePermissionsBody;
}

export interface RoleControllerUpdatePermissionsResponses {
  200: {
    data: RolePermissions;
  };
}

export type RoleControllerUpdatePermissionsResponse = RoleControllerUpdatePermissionsResponses[200];

export type RoleControllerUpdatePermissionsResult = ApiResponse<
  200,
  RoleControllerUpdatePermissionsResponses[200]
>;

export function getRoleControllerUpdatePermissionsUrl(
  path: RoleControllerUpdatePermissionsPathParams,
): string {
  return buildUrl('/roles/{id}/permissions', path);
}

// GET /roles/{id}/users

export interface RoleControllerListUsersPathParams {
  id: string;
}

export interface RoleControllerListUsersInput {
  path: RoleControllerListUsersPathParams;
}

export interface RoleControllerListUsersResponses {
  200: {
    data: {
      items: Array<RoleHolder>;
      pagination: {
        offset: number;
        limit: number;
        total: number;
      };
    };
  };
}

export type RoleControllerListUsersResponse = RoleControllerListUsersResponses[200];

export type RoleControllerListUsersResult = ApiResponse<200, RoleControllerListUsersResponses[200]>;

export function getRoleControllerListUsersUrl(path: RoleControllerListUsersPathParams): string {
  return buildUrl('/roles/{id}/users', path);
}

// POST /roles/{id}/duplicate

export interface RoleControllerDuplicatePathParams {
  id: string;
}

export type RoleControllerDuplicateBody = DuplicateRoleRequest;

export interface RoleControllerDuplicateInput {
  path: RoleControllerDuplicatePathParams;
  body: RoleControllerDuplicateBody;
}

export interface RoleControllerDuplicateResponses {
  201: {
    data: Role;
  };
}

export type RoleControllerDuplicateResponse = RoleControllerDuplicateResponses[201];

export type RoleControllerDuplicateResult = ApiResponse<201, RoleControllerDuplicateResponses[201]>;

export function getRoleControllerDuplicateUrl(path: RoleControllerDuplicatePathParams): string {
  return buildUrl('/roles/{id}/duplicate', path);
}
