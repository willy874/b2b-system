// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  AuthzExplainControllerPermissionSourcesInput,
  AuthzExplainControllerPermissionSourcesResult,
  UserControllerCreateInput,
  UserControllerCreateResult,
  UserControllerFindOneInput,
  UserControllerFindOneResult,
  UserControllerListPermissionsInput,
  UserControllerListPermissionsResult,
  UserControllerListResult,
  UserControllerListRolesInput,
  UserControllerListRolesResult,
  UserControllerRemoveInput,
  UserControllerRemoveResult,
  UserControllerReplaceRolesInput,
  UserControllerReplaceRolesResult,
  UserControllerResetPasswordInput,
  UserControllerResetPasswordResult,
  UserControllerRestoreInput,
  UserControllerRestoreResult,
  UserControllerUnlockInput,
  UserControllerUnlockResult,
  UserControllerUpdateInput,
  UserControllerUpdateResult,
} from '../../endpoints/users';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';
import {
  CreateUserRequestSchema,
  PermissionSourcesSchema,
  ReplaceUserRolesRequestSchema,
  UpdateUserRequestSchema,
  UserRolesSchema,
  UserSchema,
} from '../components';

// GET /users

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

export const UserControllerCreateSchemas = {
  body: CreateUserRequestSchema,
  responses: {
    201: z.object({
      data: UserSchema,
    }),
  },
} satisfies OperationSchemas;

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

export const UserControllerRemoveSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

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

export const UserControllerListPermissionsSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

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

export const UserControllerResetPasswordSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

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

// GET /users/{id}/permission-sources

export const AuthzExplainControllerPermissionSourcesSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: PermissionSourcesSchema,
    }),
  },
} satisfies OperationSchemas;

const authzExplainControllerPermissionSourcesOperation: OperationDefinition = {
  id: 'AuthzExplainController_permissionSources',
  method: 'GET',
  path: '/users/{id}/permission-sources',
  responseTypes: { 200: 'json' },
  schemas: AuthzExplainControllerPermissionSourcesSchemas,
};

/** 使用者的有效權限與來源（自己，或需要 authz:explain） */
export function authzExplainControllerPermissionSources(
  input: AuthzExplainControllerPermissionSourcesInput,
  options?: RequestOptions,
): Promise<AuthzExplainControllerPermissionSourcesResult> {
  return request<AuthzExplainControllerPermissionSourcesResult>(
    authzExplainControllerPermissionSourcesOperation,
    input,
    options,
  );
}
