// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  CreateGroupRequest,
  GroupMember,
  GroupRoles,
  RestoredGroup,
  UpdateGroupMembersRequest,
  UpdateGroupRequest,
  UpdateGroupRolesRequest,
} from '../models';
import { buildUrl, request } from '../runtime';
import type {
  ApiResponse,
  OperationDefinition,
  OperationSchemas,
  RequestOptions,
} from '../runtime';
import {
  CreateGroupRequestSchema,
  GroupMemberSchema,
  GroupRolesSchema,
  RestoredGroupSchema,
  UpdateGroupMembersRequestSchema,
  UpdateGroupRequestSchema,
  UpdateGroupRolesRequestSchema,
} from '../schemas';

// GET /groups

export interface GroupControllerListResponses {
  200: {
    data: {
      items: Array<RestoredGroup>;
      pagination: {
        offset: number;
        limit: number;
        total: number;
      };
    };
  };
}

export type GroupControllerListResponse = GroupControllerListResponses[200];

export type GroupControllerListResult = ApiResponse<200, GroupControllerListResponses[200]>;

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

export function getGroupControllerListUrl(): string {
  return buildUrl('/groups');
}

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

export type GroupControllerCreateBody = CreateGroupRequest;

export interface GroupControllerCreateInput {
  body: GroupControllerCreateBody;
}

export interface GroupControllerCreateResponses {
  201: {
    data: RestoredGroup;
  };
}

export type GroupControllerCreateResponse = GroupControllerCreateResponses[201];

export type GroupControllerCreateResult = ApiResponse<201, GroupControllerCreateResponses[201]>;

export const GroupControllerCreateSchemas = {
  body: CreateGroupRequestSchema,
  responses: {
    201: z.object({
      data: RestoredGroupSchema,
    }),
  },
} satisfies OperationSchemas;

export function getGroupControllerCreateUrl(): string {
  return buildUrl('/groups');
}

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

export interface GroupControllerFindOnePathParams {
  id: string;
}

export interface GroupControllerFindOneInput {
  path: GroupControllerFindOnePathParams;
}

export interface GroupControllerFindOneResponses {
  200: {
    data: RestoredGroup;
  };
}

export type GroupControllerFindOneResponse = GroupControllerFindOneResponses[200];

export type GroupControllerFindOneResult = ApiResponse<200, GroupControllerFindOneResponses[200]>;

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

export function getGroupControllerFindOneUrl(path: GroupControllerFindOnePathParams): string {
  return buildUrl('/groups/{id}', path);
}

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

export interface GroupControllerRemovePathParams {
  id: string;
}

export interface GroupControllerRemoveInput {
  path: GroupControllerRemovePathParams;
}

export interface GroupControllerRemoveResponses {
  204: undefined;
}

export type GroupControllerRemoveResponse = GroupControllerRemoveResponses[204];

export type GroupControllerRemoveResult = ApiResponse<204, GroupControllerRemoveResponses[204]>;

export const GroupControllerRemoveSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

export function getGroupControllerRemoveUrl(path: GroupControllerRemovePathParams): string {
  return buildUrl('/groups/{id}', path);
}

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

export interface GroupControllerUpdatePathParams {
  id: string;
}

export type GroupControllerUpdateBody = UpdateGroupRequest;

export interface GroupControllerUpdateInput {
  path: GroupControllerUpdatePathParams;
  body: GroupControllerUpdateBody;
}

export interface GroupControllerUpdateResponses {
  200: {
    data: RestoredGroup;
  };
}

export type GroupControllerUpdateResponse = GroupControllerUpdateResponses[200];

export type GroupControllerUpdateResult = ApiResponse<200, GroupControllerUpdateResponses[200]>;

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

export function getGroupControllerUpdateUrl(path: GroupControllerUpdatePathParams): string {
  return buildUrl('/groups/{id}', path);
}

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

export interface GroupControllerRestorePathParams {
  id: string;
}

export interface GroupControllerRestoreInput {
  path: GroupControllerRestorePathParams;
}

export interface GroupControllerRestoreResponses {
  200: {
    data: RestoredGroup;
  };
}

export type GroupControllerRestoreResponse = GroupControllerRestoreResponses[200];

export type GroupControllerRestoreResult = ApiResponse<200, GroupControllerRestoreResponses[200]>;

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

export function getGroupControllerRestoreUrl(path: GroupControllerRestorePathParams): string {
  return buildUrl('/groups/{id}/restore', path);
}

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

export interface GroupControllerListMembersPathParams {
  id: string;
}

export interface GroupControllerListMembersInput {
  path: GroupControllerListMembersPathParams;
}

export interface GroupControllerListMembersResponses {
  200: {
    data: {
      items: Array<GroupMember>;
      pagination: {
        offset: number;
        limit: number;
        total: number;
      };
    };
  };
}

export type GroupControllerListMembersResponse = GroupControllerListMembersResponses[200];

export type GroupControllerListMembersResult = ApiResponse<
  200,
  GroupControllerListMembersResponses[200]
>;

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

export function getGroupControllerListMembersUrl(
  path: GroupControllerListMembersPathParams,
): string {
  return buildUrl('/groups/{id}/members', path);
}

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

export interface GroupControllerUpdateMembersPathParams {
  id: string;
}

export type GroupControllerUpdateMembersBody = UpdateGroupMembersRequest;

export interface GroupControllerUpdateMembersInput {
  path: GroupControllerUpdateMembersPathParams;
  body: GroupControllerUpdateMembersBody;
}

export interface GroupControllerUpdateMembersResponses {
  200: {
    data: RestoredGroup;
  };
}

export type GroupControllerUpdateMembersResponse = GroupControllerUpdateMembersResponses[200];

export type GroupControllerUpdateMembersResult = ApiResponse<
  200,
  GroupControllerUpdateMembersResponses[200]
>;

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

export function getGroupControllerUpdateMembersUrl(
  path: GroupControllerUpdateMembersPathParams,
): string {
  return buildUrl('/groups/{id}/members', path);
}

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

export interface GroupControllerListRolesPathParams {
  id: string;
}

export interface GroupControllerListRolesInput {
  path: GroupControllerListRolesPathParams;
}

export interface GroupControllerListRolesResponses {
  200: {
    data: GroupRoles;
  };
}

export type GroupControllerListRolesResponse = GroupControllerListRolesResponses[200];

export type GroupControllerListRolesResult = ApiResponse<
  200,
  GroupControllerListRolesResponses[200]
>;

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

export function getGroupControllerListRolesUrl(path: GroupControllerListRolesPathParams): string {
  return buildUrl('/groups/{id}/roles', path);
}

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

export interface GroupControllerUpdateRolesPathParams {
  id: string;
}

export type GroupControllerUpdateRolesBody = UpdateGroupRolesRequest;

export interface GroupControllerUpdateRolesInput {
  path: GroupControllerUpdateRolesPathParams;
  body: GroupControllerUpdateRolesBody;
}

export interface GroupControllerUpdateRolesResponses {
  200: {
    data: GroupRoles;
  };
}

export type GroupControllerUpdateRolesResponse = GroupControllerUpdateRolesResponses[200];

export type GroupControllerUpdateRolesResult = ApiResponse<
  200,
  GroupControllerUpdateRolesResponses[200]
>;

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

export function getGroupControllerUpdateRolesUrl(
  path: GroupControllerUpdateRolesPathParams,
): string {
  return buildUrl('/groups/{id}/roles', path);
}

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
