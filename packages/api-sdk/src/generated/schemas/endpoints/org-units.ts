// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  OrgUnitControllerCreateInput,
  OrgUnitControllerCreateResult,
  OrgUnitControllerFindOneInput,
  OrgUnitControllerFindOneResult,
  OrgUnitControllerListMembersInput,
  OrgUnitControllerListMembersResult,
  OrgUnitControllerListResult,
  OrgUnitControllerMoveInput,
  OrgUnitControllerMoveResult,
  OrgUnitControllerRemoveInput,
  OrgUnitControllerRemoveResult,
  OrgUnitControllerRestoreInput,
  OrgUnitControllerRestoreResult,
  OrgUnitControllerUpdateInput,
  OrgUnitControllerUpdateMembersInput,
  OrgUnitControllerUpdateMembersResult,
  OrgUnitControllerUpdateResult,
  UserOrgUnitControllerListOfUserInput,
  UserOrgUnitControllerListOfUserResult,
} from '../../endpoints/org-units';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';
import {
  CreateOrgUnitRequestSchema,
  MoveOrgUnitRequestSchema,
  OrgUnitDetailSchema,
  OrgUnitMemberSchema,
  OrgUnitTreeSchema,
  UpdateOrgUnitMembersRequestSchema,
  UpdateOrgUnitRequestSchema,
  UserOrgUnitsSchema,
} from '../components';

// GET /org-units

export const OrgUnitControllerListSchemas = {
  responses: {
    200: z.object({
      data: OrgUnitTreeSchema,
    }),
  },
} satisfies OperationSchemas;

const orgUnitControllerListOperation: OperationDefinition = {
  id: 'OrgUnitController_list',
  method: 'GET',
  path: '/org-units',
  responseTypes: { 200: 'json' },
  schemas: OrgUnitControllerListSchemas,
};

/** 整棵部門樹（扁平陣列） */
export function orgUnitControllerList(
  options?: RequestOptions,
): Promise<OrgUnitControllerListResult> {
  return request<OrgUnitControllerListResult>(orgUnitControllerListOperation, {}, options);
}

// POST /org-units

export const OrgUnitControllerCreateSchemas = {
  body: CreateOrgUnitRequestSchema,
  responses: {
    201: z.object({
      data: OrgUnitDetailSchema,
    }),
  },
} satisfies OperationSchemas;

const orgUnitControllerCreateOperation: OperationDefinition = {
  id: 'OrgUnitController_create',
  method: 'POST',
  path: '/org-units',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 201: 'json' },
  schemas: OrgUnitControllerCreateSchemas,
};

export function orgUnitControllerCreate(
  input: OrgUnitControllerCreateInput,
  options?: RequestOptions,
): Promise<OrgUnitControllerCreateResult> {
  return request<OrgUnitControllerCreateResult>(orgUnitControllerCreateOperation, input, options);
}

// GET /org-units/{id}

export const OrgUnitControllerFindOneSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: OrgUnitDetailSchema,
    }),
  },
} satisfies OperationSchemas;

const orgUnitControllerFindOneOperation: OperationDefinition = {
  id: 'OrgUnitController_findOne',
  method: 'GET',
  path: '/org-units/{id}',
  responseTypes: { 200: 'json' },
  schemas: OrgUnitControllerFindOneSchemas,
};

export function orgUnitControllerFindOne(
  input: OrgUnitControllerFindOneInput,
  options?: RequestOptions,
): Promise<OrgUnitControllerFindOneResult> {
  return request<OrgUnitControllerFindOneResult>(orgUnitControllerFindOneOperation, input, options);
}

// DELETE /org-units/{id}

export const OrgUnitControllerRemoveSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

const orgUnitControllerRemoveOperation: OperationDefinition = {
  id: 'OrgUnitController_remove',
  method: 'DELETE',
  path: '/org-units/{id}',
  responseTypes: { 204: 'none' },
  schemas: OrgUnitControllerRemoveSchemas,
};

export function orgUnitControllerRemove(
  input: OrgUnitControllerRemoveInput,
  options?: RequestOptions,
): Promise<OrgUnitControllerRemoveResult> {
  return request<OrgUnitControllerRemoveResult>(orgUnitControllerRemoveOperation, input, options);
}

// PATCH /org-units/{id}

export const OrgUnitControllerUpdateSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: UpdateOrgUnitRequestSchema,
  responses: {
    200: z.object({
      data: OrgUnitDetailSchema,
    }),
  },
} satisfies OperationSchemas;

const orgUnitControllerUpdateOperation: OperationDefinition = {
  id: 'OrgUnitController_update',
  method: 'PATCH',
  path: '/org-units/{id}',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: OrgUnitControllerUpdateSchemas,
};

export function orgUnitControllerUpdate(
  input: OrgUnitControllerUpdateInput,
  options?: RequestOptions,
): Promise<OrgUnitControllerUpdateResult> {
  return request<OrgUnitControllerUpdateResult>(orgUnitControllerUpdateOperation, input, options);
}

// POST /org-units/{id}/move

export const OrgUnitControllerMoveSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: MoveOrgUnitRequestSchema,
  responses: {
    200: z.object({
      data: OrgUnitDetailSchema,
    }),
  },
} satisfies OperationSchemas;

const orgUnitControllerMoveOperation: OperationDefinition = {
  id: 'OrgUnitController_move',
  method: 'POST',
  path: '/org-units/{id}/move',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: OrgUnitControllerMoveSchemas,
};

/** 搬移部門（換上層、同層排序） */
export function orgUnitControllerMove(
  input: OrgUnitControllerMoveInput,
  options?: RequestOptions,
): Promise<OrgUnitControllerMoveResult> {
  return request<OrgUnitControllerMoveResult>(orgUnitControllerMoveOperation, input, options);
}

// POST /org-units/{id}/restore

export const OrgUnitControllerRestoreSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: OrgUnitDetailSchema,
    }),
  },
} satisfies OperationSchemas;

const orgUnitControllerRestoreOperation: OperationDefinition = {
  id: 'OrgUnitController_restore',
  method: 'POST',
  path: '/org-units/{id}/restore',
  responseTypes: { 200: 'json' },
  schemas: OrgUnitControllerRestoreSchemas,
};

/** 還原刪除的部門（成員資格一併恢復） */
export function orgUnitControllerRestore(
  input: OrgUnitControllerRestoreInput,
  options?: RequestOptions,
): Promise<OrgUnitControllerRestoreResult> {
  return request<OrgUnitControllerRestoreResult>(orgUnitControllerRestoreOperation, input, options);
}

// GET /org-units/{id}/members

export const OrgUnitControllerListMembersSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: z.object({
        items: z.array(OrgUnitMemberSchema),
        pagination: z.object({
          offset: z.int(),
          limit: z.int(),
          total: z.int(),
        }),
      }),
    }),
  },
} satisfies OperationSchemas;

const orgUnitControllerListMembersOperation: OperationDefinition = {
  id: 'OrgUnitController_listMembers',
  method: 'GET',
  path: '/org-units/{id}/members',
  responseTypes: { 200: 'json' },
  schemas: OrgUnitControllerListMembersSchemas,
};

/** 部門的成員（可含下層部門） */
export function orgUnitControllerListMembers(
  input: OrgUnitControllerListMembersInput,
  options?: RequestOptions,
): Promise<OrgUnitControllerListMembersResult> {
  return request<OrgUnitControllerListMembersResult>(
    orgUnitControllerListMembersOperation,
    input,
    options,
  );
}

// PATCH /org-units/{id}/members

export const OrgUnitControllerUpdateMembersSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: UpdateOrgUnitMembersRequestSchema,
  responses: {
    200: z.object({
      data: OrgUnitDetailSchema,
    }),
  },
} satisfies OperationSchemas;

const orgUnitControllerUpdateMembersOperation: OperationDefinition = {
  id: 'OrgUnitController_updateMembers',
  method: 'PATCH',
  path: '/org-units/{id}/members',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: OrgUnitControllerUpdateMembersSchemas,
};

/** 增減、修改部門的成員（差異語意） */
export function orgUnitControllerUpdateMembers(
  input: OrgUnitControllerUpdateMembersInput,
  options?: RequestOptions,
): Promise<OrgUnitControllerUpdateMembersResult> {
  return request<OrgUnitControllerUpdateMembersResult>(
    orgUnitControllerUpdateMembersOperation,
    input,
    options,
  );
}

// GET /users/{id}/org-units

export const UserOrgUnitControllerListOfUserSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: UserOrgUnitsSchema,
    }),
  },
} satisfies OperationSchemas;

const userOrgUnitControllerListOfUserOperation: OperationDefinition = {
  id: 'UserOrgUnitController_listOfUser',
  method: 'GET',
  path: '/users/{id}/org-units',
  responseTypes: { 200: 'json' },
  schemas: UserOrgUnitControllerListOfUserSchemas,
};

/** 使用者所屬的部門（主要部門在前） */
export function userOrgUnitControllerListOfUser(
  input: UserOrgUnitControllerListOfUserInput,
  options?: RequestOptions,
): Promise<UserOrgUnitControllerListOfUserResult> {
  return request<UserOrgUnitControllerListOfUserResult>(
    userOrgUnitControllerListOfUserOperation,
    input,
    options,
  );
}
