// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type {
  CreateUserRequest,
  MfaAccountStatus,
  PermissionSources,
  ReplaceUserRolesRequest,
  UpdateUserRequest,
  User,
  UserRoles,
} from '../models';
import type { ApiResponse } from '../runtime';
import { buildUrl } from '../url';

// GET /users/{id}/mfa

export interface UserMfaControllerStatusPathParams {
  id: string;
}

export interface UserMfaControllerStatusInput {
  path: UserMfaControllerStatusPathParams;
}

export interface UserMfaControllerStatusResponses {
  200: {
    data: MfaAccountStatus;
  };
}

export type UserMfaControllerStatusResponse = UserMfaControllerStatusResponses[200];

export type UserMfaControllerStatusResult = ApiResponse<200, UserMfaControllerStatusResponses[200]>;

export function getUserMfaControllerStatusUrl(path: UserMfaControllerStatusPathParams): string {
  return buildUrl('/users/{id}/mfa', path);
}

// POST /users/{id}/mfa/reset

export interface UserMfaControllerResetPathParams {
  id: string;
}

export interface UserMfaControllerResetInput {
  path: UserMfaControllerResetPathParams;
}

export interface UserMfaControllerResetResponses {
  200: undefined;
}

export type UserMfaControllerResetResponse = UserMfaControllerResetResponses[200];

export type UserMfaControllerResetResult = ApiResponse<200, UserMfaControllerResetResponses[200]>;

export function getUserMfaControllerResetUrl(path: UserMfaControllerResetPathParams): string {
  return buildUrl('/users/{id}/mfa/reset', path);
}

// GET /users

export interface UserControllerListResponses {
  200: {
    data: {
      items: Array<User>;
      pagination: {
        offset: number;
        limit: number;
        total: number;
      };
    };
  };
}

export type UserControllerListResponse = UserControllerListResponses[200];

export type UserControllerListResult = ApiResponse<200, UserControllerListResponses[200]>;

export function getUserControllerListUrl(): string {
  return buildUrl('/users');
}

// POST /users

export type UserControllerCreateBody = CreateUserRequest;

export interface UserControllerCreateInput {
  body: UserControllerCreateBody;
}

export interface UserControllerCreateResponses {
  201: {
    data: User;
  };
}

export type UserControllerCreateResponse = UserControllerCreateResponses[201];

export type UserControllerCreateResult = ApiResponse<201, UserControllerCreateResponses[201]>;

export function getUserControllerCreateUrl(): string {
  return buildUrl('/users');
}

// GET /users/{id}

export interface UserControllerFindOnePathParams {
  id: string;
}

export interface UserControllerFindOneInput {
  path: UserControllerFindOnePathParams;
}

export interface UserControllerFindOneResponses {
  200: {
    data: User;
  };
}

export type UserControllerFindOneResponse = UserControllerFindOneResponses[200];

export type UserControllerFindOneResult = ApiResponse<200, UserControllerFindOneResponses[200]>;

export function getUserControllerFindOneUrl(path: UserControllerFindOnePathParams): string {
  return buildUrl('/users/{id}', path);
}

// DELETE /users/{id}

export interface UserControllerRemovePathParams {
  id: string;
}

export interface UserControllerRemoveInput {
  path: UserControllerRemovePathParams;
}

export interface UserControllerRemoveResponses {
  204: undefined;
}

export type UserControllerRemoveResponse = UserControllerRemoveResponses[204];

export type UserControllerRemoveResult = ApiResponse<204, UserControllerRemoveResponses[204]>;

export function getUserControllerRemoveUrl(path: UserControllerRemovePathParams): string {
  return buildUrl('/users/{id}', path);
}

// PATCH /users/{id}

export interface UserControllerUpdatePathParams {
  id: string;
}

export type UserControllerUpdateBody = UpdateUserRequest;

export interface UserControllerUpdateInput {
  path: UserControllerUpdatePathParams;
  body: UserControllerUpdateBody;
}

export interface UserControllerUpdateResponses {
  200: {
    data: User;
  };
}

export type UserControllerUpdateResponse = UserControllerUpdateResponses[200];

export type UserControllerUpdateResult = ApiResponse<200, UserControllerUpdateResponses[200]>;

export function getUserControllerUpdateUrl(path: UserControllerUpdatePathParams): string {
  return buildUrl('/users/{id}', path);
}

// POST /users/{id}/restore

export interface UserControllerRestorePathParams {
  id: string;
}

export interface UserControllerRestoreInput {
  path: UserControllerRestorePathParams;
}

export interface UserControllerRestoreResponses {
  200: {
    data: User;
  };
}

export type UserControllerRestoreResponse = UserControllerRestoreResponses[200];

export type UserControllerRestoreResult = ApiResponse<200, UserControllerRestoreResponses[200]>;

export function getUserControllerRestoreUrl(path: UserControllerRestorePathParams): string {
  return buildUrl('/users/{id}/restore', path);
}

// GET /users/{id}/roles

export interface UserControllerListRolesPathParams {
  id: string;
}

export interface UserControllerListRolesInput {
  path: UserControllerListRolesPathParams;
}

export interface UserControllerListRolesResponses {
  200: {
    data: UserRoles;
  };
}

export type UserControllerListRolesResponse = UserControllerListRolesResponses[200];

export type UserControllerListRolesResult = ApiResponse<200, UserControllerListRolesResponses[200]>;

export function getUserControllerListRolesUrl(path: UserControllerListRolesPathParams): string {
  return buildUrl('/users/{id}/roles', path);
}

// PUT /users/{id}/roles

export interface UserControllerReplaceRolesPathParams {
  id: string;
}

export type UserControllerReplaceRolesBody = ReplaceUserRolesRequest;

export interface UserControllerReplaceRolesInput {
  path: UserControllerReplaceRolesPathParams;
  body: UserControllerReplaceRolesBody;
}

export interface UserControllerReplaceRolesResponses {
  200: {
    data: UserRoles;
  };
}

export type UserControllerReplaceRolesResponse = UserControllerReplaceRolesResponses[200];

export type UserControllerReplaceRolesResult = ApiResponse<
  200,
  UserControllerReplaceRolesResponses[200]
>;

export function getUserControllerReplaceRolesUrl(
  path: UserControllerReplaceRolesPathParams,
): string {
  return buildUrl('/users/{id}/roles', path);
}

// GET /users/{id}/permissions

export interface UserControllerListPermissionsPathParams {
  id: string;
}

export interface UserControllerListPermissionsInput {
  path: UserControllerListPermissionsPathParams;
}

export interface UserControllerListPermissionsResponses {
  200: undefined;
}

export type UserControllerListPermissionsResponse = UserControllerListPermissionsResponses[200];

export type UserControllerListPermissionsResult = ApiResponse<
  200,
  UserControllerListPermissionsResponses[200]
>;

export function getUserControllerListPermissionsUrl(
  path: UserControllerListPermissionsPathParams,
): string {
  return buildUrl('/users/{id}/permissions', path);
}

// POST /users/{id}/reset-password

export interface UserControllerResetPasswordPathParams {
  id: string;
}

export interface UserControllerResetPasswordInput {
  path: UserControllerResetPasswordPathParams;
}

export interface UserControllerResetPasswordResponses {
  200: undefined;
}

export type UserControllerResetPasswordResponse = UserControllerResetPasswordResponses[200];

export type UserControllerResetPasswordResult = ApiResponse<
  200,
  UserControllerResetPasswordResponses[200]
>;

export function getUserControllerResetPasswordUrl(
  path: UserControllerResetPasswordPathParams,
): string {
  return buildUrl('/users/{id}/reset-password', path);
}

// POST /users/{id}/unlock

export interface UserControllerUnlockPathParams {
  id: string;
}

export interface UserControllerUnlockInput {
  path: UserControllerUnlockPathParams;
}

export interface UserControllerUnlockResponses {
  200: {
    data: User;
  };
}

export type UserControllerUnlockResponse = UserControllerUnlockResponses[200];

export type UserControllerUnlockResult = ApiResponse<200, UserControllerUnlockResponses[200]>;

export function getUserControllerUnlockUrl(path: UserControllerUnlockPathParams): string {
  return buildUrl('/users/{id}/unlock', path);
}

// GET /users/{id}/permission-sources

export interface AuthzExplainControllerPermissionSourcesPathParams {
  id: string;
}

export interface AuthzExplainControllerPermissionSourcesInput {
  path: AuthzExplainControllerPermissionSourcesPathParams;
}

export interface AuthzExplainControllerPermissionSourcesResponses {
  200: {
    data: PermissionSources;
  };
}

export type AuthzExplainControllerPermissionSourcesResponse =
  AuthzExplainControllerPermissionSourcesResponses[200];

export type AuthzExplainControllerPermissionSourcesResult = ApiResponse<
  200,
  AuthzExplainControllerPermissionSourcesResponses[200]
>;

export function getAuthzExplainControllerPermissionSourcesUrl(
  path: AuthzExplainControllerPermissionSourcesPathParams,
): string {
  return buildUrl('/users/{id}/permission-sources', path);
}
