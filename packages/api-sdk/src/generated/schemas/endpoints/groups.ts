// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  GroupControllerCreateInput,
  GroupControllerCreateResult,
  GroupControllerFindOneInput,
  GroupControllerFindOneResult,
  GroupControllerListMembersInput,
  GroupControllerListMembersResult,
  GroupControllerListResult,
  GroupControllerListRolesInput,
  GroupControllerListRolesResult,
  GroupControllerRemoveInput,
  GroupControllerRemoveResult,
  GroupControllerRestoreInput,
  GroupControllerRestoreResult,
  GroupControllerUpdateInput,
  GroupControllerUpdateMembersInput,
  GroupControllerUpdateMembersResult,
  GroupControllerUpdateResult,
  GroupControllerUpdateRolesInput,
  GroupControllerUpdateRolesResult,
} from '../../endpoints/groups';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';
import {
  CreateGroupRequestSchema,
  GroupMemberSchema,
  GroupRolesSchema,
  RestoredGroupSchema,
  UpdateGroupMembersRequestSchema,
  UpdateGroupRequestSchema,
  UpdateGroupRolesRequestSchema,
} from '../components';

// GET /groups

export const GroupControllerListSchemas = {
  responses: {
    200: z.object({
      data: z.object({
        items: z.array(RestoredGroupSchema),
        pagination: z.object({
          offset: z.int(),
          limit: z.int(),
          total: z.int(),
        }),
      }),
    }),
  },
} satisfies OperationSchemas;

const groupControllerListOperation: OperationDefinition = {
  id: 'GroupController_list',
  method: 'GET',
  path: '/groups',
  responseTypes: { 200: 'json' },
  schemas: GroupControllerListSchemas,
};

export function groupControllerList(options?: RequestOptions): Promise<GroupControllerListResult> {
  return request<GroupControllerListResult>(groupControllerListOperation, {}, options);
}

// POST /groups

export const GroupControllerCreateSchemas = {
  body: CreateGroupRequestSchema,
  responses: {
    201: z.object({
      data: RestoredGroupSchema,
    }),
  },
} satisfies OperationSchemas;

const groupControllerCreateOperation: OperationDefinition = {
  id: 'GroupController_create',
  method: 'POST',
  path: '/groups',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 201: 'json' },
  schemas: GroupControllerCreateSchemas,
};

export function groupControllerCreate(
  input: GroupControllerCreateInput,
  options?: RequestOptions,
): Promise<GroupControllerCreateResult> {
  return request<GroupControllerCreateResult>(groupControllerCreateOperation, input, options);
}

// GET /groups/{id}

export const GroupControllerFindOneSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: RestoredGroupSchema,
    }),
  },
} satisfies OperationSchemas;

const groupControllerFindOneOperation: OperationDefinition = {
  id: 'GroupController_findOne',
  method: 'GET',
  path: '/groups/{id}',
  responseTypes: { 200: 'json' },
  schemas: GroupControllerFindOneSchemas,
};

export function groupControllerFindOne(
  input: GroupControllerFindOneInput,
  options?: RequestOptions,
): Promise<GroupControllerFindOneResult> {
  return request<GroupControllerFindOneResult>(groupControllerFindOneOperation, input, options);
}

// DELETE /groups/{id}

export const GroupControllerRemoveSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

const groupControllerRemoveOperation: OperationDefinition = {
  id: 'GroupController_remove',
  method: 'DELETE',
  path: '/groups/{id}',
  responseTypes: { 204: 'none' },
  schemas: GroupControllerRemoveSchemas,
};

export function groupControllerRemove(
  input: GroupControllerRemoveInput,
  options?: RequestOptions,
): Promise<GroupControllerRemoveResult> {
  return request<GroupControllerRemoveResult>(groupControllerRemoveOperation, input, options);
}

// PATCH /groups/{id}

export const GroupControllerUpdateSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: UpdateGroupRequestSchema,
  responses: {
    200: z.object({
      data: RestoredGroupSchema,
    }),
  },
} satisfies OperationSchemas;

const groupControllerUpdateOperation: OperationDefinition = {
  id: 'GroupController_update',
  method: 'PATCH',
  path: '/groups/{id}',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: GroupControllerUpdateSchemas,
};

export function groupControllerUpdate(
  input: GroupControllerUpdateInput,
  options?: RequestOptions,
): Promise<GroupControllerUpdateResult> {
  return request<GroupControllerUpdateResult>(groupControllerUpdateOperation, input, options);
}

// POST /groups/{id}/restore

export const GroupControllerRestoreSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: RestoredGroupSchema,
    }),
  },
} satisfies OperationSchemas;

const groupControllerRestoreOperation: OperationDefinition = {
  id: 'GroupController_restore',
  method: 'POST',
  path: '/groups/{id}/restore',
  responseTypes: { 200: 'json' },
  schemas: GroupControllerRestoreSchemas,
};

/** 還原刪除的群組（成員與持有的角色一併恢復） */
export function groupControllerRestore(
  input: GroupControllerRestoreInput,
  options?: RequestOptions,
): Promise<GroupControllerRestoreResult> {
  return request<GroupControllerRestoreResult>(groupControllerRestoreOperation, input, options);
}

// GET /groups/{id}/members

export const GroupControllerListMembersSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: z.object({
        items: z.array(GroupMemberSchema),
        pagination: z.object({
          offset: z.int(),
          limit: z.int(),
          total: z.int(),
        }),
      }),
    }),
  },
} satisfies OperationSchemas;

const groupControllerListMembersOperation: OperationDefinition = {
  id: 'GroupController_listMembers',
  method: 'GET',
  path: '/groups/{id}/members',
  responseTypes: { 200: 'json' },
  schemas: GroupControllerListMembersSchemas,
};

/** 群組的直接成員（使用者與巢狀的群組） */
export function groupControllerListMembers(
  input: GroupControllerListMembersInput,
  options?: RequestOptions,
): Promise<GroupControllerListMembersResult> {
  return request<GroupControllerListMembersResult>(
    groupControllerListMembersOperation,
    input,
    options,
  );
}

// PATCH /groups/{id}/members

export const GroupControllerUpdateMembersSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: UpdateGroupMembersRequestSchema,
  responses: {
    200: z.object({
      data: RestoredGroupSchema,
    }),
  },
} satisfies OperationSchemas;

const groupControllerUpdateMembersOperation: OperationDefinition = {
  id: 'GroupController_updateMembers',
  method: 'PATCH',
  path: '/groups/{id}/members',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: GroupControllerUpdateMembersSchemas,
};

/** 增減群組的成員（差異語意） */
export function groupControllerUpdateMembers(
  input: GroupControllerUpdateMembersInput,
  options?: RequestOptions,
): Promise<GroupControllerUpdateMembersResult> {
  return request<GroupControllerUpdateMembersResult>(
    groupControllerUpdateMembersOperation,
    input,
    options,
  );
}

// GET /groups/{id}/roles

export const GroupControllerListRolesSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: GroupRolesSchema,
    }),
  },
} satisfies OperationSchemas;

const groupControllerListRolesOperation: OperationDefinition = {
  id: 'GroupController_listRoles',
  method: 'GET',
  path: '/groups/{id}/roles',
  responseTypes: { 200: 'json' },
  schemas: GroupControllerListRolesSchemas,
};

/** 群組持有的角色 */
export function groupControllerListRoles(
  input: GroupControllerListRolesInput,
  options?: RequestOptions,
): Promise<GroupControllerListRolesResult> {
  return request<GroupControllerListRolesResult>(groupControllerListRolesOperation, input, options);
}

// PATCH /groups/{id}/roles

export const GroupControllerUpdateRolesSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: UpdateGroupRolesRequestSchema,
  responses: {
    200: z.object({
      data: GroupRolesSchema,
    }),
  },
} satisfies OperationSchemas;

const groupControllerUpdateRolesOperation: OperationDefinition = {
  id: 'GroupController_updateRoles',
  method: 'PATCH',
  path: '/groups/{id}/roles',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: GroupControllerUpdateRolesSchemas,
};

/** 增減群組持有的角色（差異語意） */
export function groupControllerUpdateRoles(
  input: GroupControllerUpdateRolesInput,
  options?: RequestOptions,
): Promise<GroupControllerUpdateRolesResult> {
  return request<GroupControllerUpdateRolesResult>(
    groupControllerUpdateRolesOperation,
    input,
    options,
  );
}
