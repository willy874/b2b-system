// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  CreateUserRequest,
  ReplaceUserRolesRequest,
  UpdateUserRequest,
  User,
  UserRoles,
} from '../models';
import { buildUrl, request } from '../runtime';
import type {
  ApiResponse,
  OperationDefinition,
  OperationSchemas,
  RequestOptions,
} from '../runtime';
import {
  CreateUserRequestSchema,
  ReplaceUserRolesRequestSchema,
  UpdateUserRequestSchema,
  UserRolesSchema,
  UserSchema,
} from '../schemas';

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

export const UserControllerListSchemas = {
  responses: {
    200: z.object({
      data: z.object({
        items: z.array(UserSchema),
        pagination: z.object({
          offset: z.int(),
          limit: z.int(),
          total: z.int(),
        }),
      }),
    }),
  },
} satisfies OperationSchemas;

export function getUserControllerListUrl(): string {
  return buildUrl('/users');
}

const userControllerListOperation: OperationDefinition = {
  id: 'UserController_list',
  method: 'GET',
  path: '/users',
  responseTypes: { 200: 'json' },
  schemas: UserControllerListSchemas,
};

/** 使用者列表 */
export function userControllerList(options?: RequestOptions): Promise<UserControllerListResult> {
  return request<UserControllerListResult>(userControllerListOperation, {}, options);
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

export const UserControllerCreateSchemas = {
  body: CreateUserRequestSchema,
  responses: {
    201: z.object({
      data: UserSchema,
    }),
  },
} satisfies OperationSchemas;

export function getUserControllerCreateUrl(): string {
  return buildUrl('/users');
}

const userControllerCreateOperation: OperationDefinition = {
  id: 'UserController_create',
  method: 'POST',
  path: '/users',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 201: 'json' },
  schemas: UserControllerCreateSchemas,
};

/** 建立使用者（status = pending，寄啟用信） */
export function userControllerCreate(
  input: UserControllerCreateInput,
  options?: RequestOptions,
): Promise<UserControllerCreateResult> {
  return request<UserControllerCreateResult>(userControllerCreateOperation, input, options);
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

export const UserControllerFindOneSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: UserSchema,
    }),
  },
} satisfies OperationSchemas;

export function getUserControllerFindOneUrl(path: UserControllerFindOnePathParams): string {
  return buildUrl('/users/{id}', path);
}

const userControllerFindOneOperation: OperationDefinition = {
  id: 'UserController_findOne',
  method: 'GET',
  path: '/users/{id}',
  responseTypes: { 200: 'json' },
  schemas: UserControllerFindOneSchemas,
};

export function userControllerFindOne(
  input: UserControllerFindOneInput,
  options?: RequestOptions,
): Promise<UserControllerFindOneResult> {
  return request<UserControllerFindOneResult>(userControllerFindOneOperation, input, options);
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

export const UserControllerRemoveSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

export function getUserControllerRemoveUrl(path: UserControllerRemovePathParams): string {
  return buildUrl('/users/{id}', path);
}

const userControllerRemoveOperation: OperationDefinition = {
  id: 'UserController_remove',
  method: 'DELETE',
  path: '/users/{id}',
  responseTypes: { 204: 'none' },
  schemas: UserControllerRemoveSchemas,
};

export function userControllerRemove(
  input: UserControllerRemoveInput,
  options?: RequestOptions,
): Promise<UserControllerRemoveResult> {
  return request<UserControllerRemoveResult>(userControllerRemoveOperation, input, options);
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

export const UserControllerUpdateSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: UpdateUserRequestSchema,
  responses: {
    200: z.object({
      data: UserSchema,
    }),
  },
} satisfies OperationSchemas;

export function getUserControllerUpdateUrl(path: UserControllerUpdatePathParams): string {
  return buildUrl('/users/{id}', path);
}

const userControllerUpdateOperation: OperationDefinition = {
  id: 'UserController_update',
  method: 'PATCH',
  path: '/users/{id}',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: UserControllerUpdateSchemas,
};

export function userControllerUpdate(
  input: UserControllerUpdateInput,
  options?: RequestOptions,
): Promise<UserControllerUpdateResult> {
  return request<UserControllerUpdateResult>(userControllerUpdateOperation, input, options);
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

export const UserControllerRestoreSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: UserSchema,
    }),
  },
} satisfies OperationSchemas;

export function getUserControllerRestoreUrl(path: UserControllerRestorePathParams): string {
  return buildUrl('/users/{id}/restore', path);
}

const userControllerRestoreOperation: OperationDefinition = {
  id: 'UserController_restore',
  method: 'POST',
  path: '/users/{id}/restore',
  responseTypes: { 200: 'json' },
  schemas: UserControllerRestoreSchemas,
};

/** 還原刪除的使用者 */
export function userControllerRestore(
  input: UserControllerRestoreInput,
  options?: RequestOptions,
): Promise<UserControllerRestoreResult> {
  return request<UserControllerRestoreResult>(userControllerRestoreOperation, input, options);
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

export const UserControllerListRolesSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: UserRolesSchema,
    }),
  },
} satisfies OperationSchemas;

export function getUserControllerListRolesUrl(path: UserControllerListRolesPathParams): string {
  return buildUrl('/users/{id}/roles', path);
}

const userControllerListRolesOperation: OperationDefinition = {
  id: 'UserController_listRoles',
  method: 'GET',
  path: '/users/{id}/roles',
  responseTypes: { 200: 'json' },
  schemas: UserControllerListRolesSchemas,
};

export function userControllerListRoles(
  input: UserControllerListRolesInput,
  options?: RequestOptions,
): Promise<UserControllerListRolesResult> {
  return request<UserControllerListRolesResult>(userControllerListRolesOperation, input, options);
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

export const UserControllerReplaceRolesSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: ReplaceUserRolesRequestSchema,
  responses: {
    200: z.object({
      data: UserRolesSchema,
    }),
  },
} satisfies OperationSchemas;

export function getUserControllerReplaceRolesUrl(
  path: UserControllerReplaceRolesPathParams,
): string {
  return buildUrl('/users/{id}/roles', path);
}

const userControllerReplaceRolesOperation: OperationDefinition = {
  id: 'UserController_replaceRoles',
  method: 'PUT',
  path: '/users/{id}/roles',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: UserControllerReplaceRolesSchemas,
};

/** 整批取代使用者的角色 */
export function userControllerReplaceRoles(
  input: UserControllerReplaceRolesInput,
  options?: RequestOptions,
): Promise<UserControllerReplaceRolesResult> {
  return request<UserControllerReplaceRolesResult>(
    userControllerReplaceRolesOperation,
    input,
    options,
  );
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

export const UserControllerListPermissionsSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

export function getUserControllerListPermissionsUrl(
  path: UserControllerListPermissionsPathParams,
): string {
  return buildUrl('/users/{id}/permissions', path);
}

const userControllerListPermissionsOperation: OperationDefinition = {
  id: 'UserController_listPermissions',
  method: 'GET',
  path: '/users/{id}/permissions',
  responseTypes: { 200: 'none' },
  schemas: UserControllerListPermissionsSchemas,
};

/** 該使用者的有效權限集合（除錯／稽核用） */
export function userControllerListPermissions(
  input: UserControllerListPermissionsInput,
  options?: RequestOptions,
): Promise<UserControllerListPermissionsResult> {
  return request<UserControllerListPermissionsResult>(
    userControllerListPermissionsOperation,
    input,
    options,
  );
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

export const UserControllerResetPasswordSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

export function getUserControllerResetPasswordUrl(
  path: UserControllerResetPasswordPathParams,
): string {
  return buildUrl('/users/{id}/reset-password', path);
}

const userControllerResetPasswordOperation: OperationDefinition = {
  id: 'UserController_resetPassword',
  method: 'POST',
  path: '/users/{id}/reset-password',
  responseTypes: { 200: 'none' },
  schemas: UserControllerResetPasswordSchemas,
};

export function userControllerResetPassword(
  input: UserControllerResetPasswordInput,
  options?: RequestOptions,
): Promise<UserControllerResetPasswordResult> {
  return request<UserControllerResetPasswordResult>(
    userControllerResetPasswordOperation,
    input,
    options,
  );
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

export const UserControllerUnlockSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: UserSchema,
    }),
  },
} satisfies OperationSchemas;

export function getUserControllerUnlockUrl(path: UserControllerUnlockPathParams): string {
  return buildUrl('/users/{id}/unlock', path);
}

const userControllerUnlockOperation: OperationDefinition = {
  id: 'UserController_unlock',
  method: 'POST',
  path: '/users/{id}/unlock',
  responseTypes: { 200: 'json' },
  schemas: UserControllerUnlockSchemas,
};

export function userControllerUnlock(
  input: UserControllerUnlockInput,
  options?: RequestOptions,
): Promise<UserControllerUnlockResult> {
  return request<UserControllerUnlockResult>(userControllerUnlockOperation, input, options);
}
