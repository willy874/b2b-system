// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  AssignWorkspaceAdminRequest,
  CreateWorkspaceRequest,
  MyWorkspaceList,
  UpdateWorkspaceMemberRolesRequest,
  UpdateWorkspaceRequest,
  Workspace,
  WorkspaceDetail,
  WorkspaceMe,
  WorkspaceMember,
  WorkspaceMemberRoles,
  WorkspaceRoleList,
} from '../models';
import { buildUrl, request } from '../runtime';
import type {
  ApiResponse,
  OperationDefinition,
  OperationSchemas,
  RequestOptions,
} from '../runtime';
import {
  AssignWorkspaceAdminRequestSchema,
  CreateWorkspaceRequestSchema,
  MyWorkspaceListSchema,
  UpdateWorkspaceMemberRolesRequestSchema,
  UpdateWorkspaceRequestSchema,
  WorkspaceDetailSchema,
  WorkspaceMeSchema,
  WorkspaceMemberRolesSchema,
  WorkspaceMemberSchema,
  WorkspaceRoleListSchema,
  WorkspaceSchema,
} from '../schemas';

// GET /workspaces/mine

export interface WorkspaceControllerListMineResponses {
  200: {
    data: MyWorkspaceList;
  };
}

export type WorkspaceControllerListMineResponse = WorkspaceControllerListMineResponses[200];

export type WorkspaceControllerListMineResult = ApiResponse<
  200,
  WorkspaceControllerListMineResponses[200]
>;

export const WorkspaceControllerListMineSchemas = {
  responses: {
    200: z.object({
      data: MyWorkspaceListSchema,
    }),
  },
} satisfies OperationSchemas;

export function getWorkspaceControllerListMineUrl(): string {
  return buildUrl('/workspaces/mine');
}

const workspaceControllerListMineOperation: OperationDefinition = {
  id: 'WorkspaceController_listMine',
  method: 'GET',
  path: '/workspaces/mine',
  responseTypes: { 200: 'json' },
  schemas: WorkspaceControllerListMineSchemas,
};

/** 自己能進入的工作區（super-admin 是全部） */
export function workspaceControllerListMine(
  options?: RequestOptions,
): Promise<WorkspaceControllerListMineResult> {
  return request<WorkspaceControllerListMineResult>(
    workspaceControllerListMineOperation,
    {},
    options,
  );
}

// GET /workspaces

export interface WorkspaceControllerListResponses {
  200: {
    data: {
      items: Array<Workspace>;
      pagination: {
        offset: number;
        limit: number;
        total: number;
      };
    };
  };
}

export type WorkspaceControllerListResponse = WorkspaceControllerListResponses[200];

export type WorkspaceControllerListResult = ApiResponse<200, WorkspaceControllerListResponses[200]>;

export const WorkspaceControllerListSchemas = {
  responses: {
    200: z.object({
      data: z.object({
        items: z.array(WorkspaceSchema),
        pagination: z.object({
          offset: z.int(),
          limit: z.int(),
          total: z.int(),
        }),
      }),
    }),
  },
} satisfies OperationSchemas;

export function getWorkspaceControllerListUrl(): string {
  return buildUrl('/workspaces');
}

const workspaceControllerListOperation: OperationDefinition = {
  id: 'WorkspaceController_list',
  method: 'GET',
  path: '/workspaces',
  responseTypes: { 200: 'json' },
  schemas: WorkspaceControllerListSchemas,
};

export function workspaceControllerList(
  options?: RequestOptions,
): Promise<WorkspaceControllerListResult> {
  return request<WorkspaceControllerListResult>(workspaceControllerListOperation, {}, options);
}

// POST /workspaces

export type WorkspaceControllerCreateBody = CreateWorkspaceRequest;

export interface WorkspaceControllerCreateInput {
  body: WorkspaceControllerCreateBody;
}

export interface WorkspaceControllerCreateResponses {
  201: {
    data: WorkspaceDetail;
  };
}

export type WorkspaceControllerCreateResponse = WorkspaceControllerCreateResponses[201];

export type WorkspaceControllerCreateResult = ApiResponse<
  201,
  WorkspaceControllerCreateResponses[201]
>;

export const WorkspaceControllerCreateSchemas = {
  body: CreateWorkspaceRequestSchema,
  responses: {
    201: z.object({
      data: WorkspaceDetailSchema,
    }),
  },
} satisfies OperationSchemas;

export function getWorkspaceControllerCreateUrl(): string {
  return buildUrl('/workspaces');
}

const workspaceControllerCreateOperation: OperationDefinition = {
  id: 'WorkspaceController_create',
  method: 'POST',
  path: '/workspaces',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 201: 'json' },
  schemas: WorkspaceControllerCreateSchemas,
};

/** 建立工作區並指定第一位管理員 */
export function workspaceControllerCreate(
  input: WorkspaceControllerCreateInput,
  options?: RequestOptions,
): Promise<WorkspaceControllerCreateResult> {
  return request<WorkspaceControllerCreateResult>(
    workspaceControllerCreateOperation,
    input,
    options,
  );
}

// GET /workspaces/{workspaceId}

export interface WorkspaceControllerFindOnePathParams {
  workspaceId: string;
}

export interface WorkspaceControllerFindOneInput {
  path: WorkspaceControllerFindOnePathParams;
}

export interface WorkspaceControllerFindOneResponses {
  200: {
    data: WorkspaceDetail;
  };
}

export type WorkspaceControllerFindOneResponse = WorkspaceControllerFindOneResponses[200];

export type WorkspaceControllerFindOneResult = ApiResponse<
  200,
  WorkspaceControllerFindOneResponses[200]
>;

export const WorkspaceControllerFindOneSchemas = {
  path: z.object({
    workspaceId: z.string(),
  }),
  responses: {
    200: z.object({
      data: WorkspaceDetailSchema,
    }),
  },
} satisfies OperationSchemas;

export function getWorkspaceControllerFindOneUrl(
  path: WorkspaceControllerFindOnePathParams,
): string {
  return buildUrl('/workspaces/{workspaceId}', path);
}

const workspaceControllerFindOneOperation: OperationDefinition = {
  id: 'WorkspaceController_findOne',
  method: 'GET',
  path: '/workspaces/{workspaceId}',
  responseTypes: { 200: 'json' },
  schemas: WorkspaceControllerFindOneSchemas,
};

export function workspaceControllerFindOne(
  input: WorkspaceControllerFindOneInput,
  options?: RequestOptions,
): Promise<WorkspaceControllerFindOneResult> {
  return request<WorkspaceControllerFindOneResult>(
    workspaceControllerFindOneOperation,
    input,
    options,
  );
}

// DELETE /workspaces/{workspaceId}

export interface WorkspaceControllerRemovePathParams {
  workspaceId: string;
}

export interface WorkspaceControllerRemoveInput {
  path: WorkspaceControllerRemovePathParams;
}

export interface WorkspaceControllerRemoveResponses {
  204: undefined;
}

export type WorkspaceControllerRemoveResponse = WorkspaceControllerRemoveResponses[204];

export type WorkspaceControllerRemoveResult = ApiResponse<
  204,
  WorkspaceControllerRemoveResponses[204]
>;

export const WorkspaceControllerRemoveSchemas = {
  path: z.object({
    workspaceId: z.string(),
  }),
} satisfies OperationSchemas;

export function getWorkspaceControllerRemoveUrl(path: WorkspaceControllerRemovePathParams): string {
  return buildUrl('/workspaces/{workspaceId}', path);
}

const workspaceControllerRemoveOperation: OperationDefinition = {
  id: 'WorkspaceController_remove',
  method: 'DELETE',
  path: '/workspaces/{workspaceId}',
  responseTypes: { 204: 'none' },
  schemas: WorkspaceControllerRemoveSchemas,
};

export function workspaceControllerRemove(
  input: WorkspaceControllerRemoveInput,
  options?: RequestOptions,
): Promise<WorkspaceControllerRemoveResult> {
  return request<WorkspaceControllerRemoveResult>(
    workspaceControllerRemoveOperation,
    input,
    options,
  );
}

// PATCH /workspaces/{workspaceId}

export interface WorkspaceControllerUpdatePathParams {
  workspaceId: string;
}

export type WorkspaceControllerUpdateBody = UpdateWorkspaceRequest;

export interface WorkspaceControllerUpdateInput {
  path: WorkspaceControllerUpdatePathParams;
  body: WorkspaceControllerUpdateBody;
}

export interface WorkspaceControllerUpdateResponses {
  200: {
    data: WorkspaceDetail;
  };
}

export type WorkspaceControllerUpdateResponse = WorkspaceControllerUpdateResponses[200];

export type WorkspaceControllerUpdateResult = ApiResponse<
  200,
  WorkspaceControllerUpdateResponses[200]
>;

export const WorkspaceControllerUpdateSchemas = {
  path: z.object({
    workspaceId: z.string(),
  }),
  body: UpdateWorkspaceRequestSchema,
  responses: {
    200: z.object({
      data: WorkspaceDetailSchema,
    }),
  },
} satisfies OperationSchemas;

export function getWorkspaceControllerUpdateUrl(path: WorkspaceControllerUpdatePathParams): string {
  return buildUrl('/workspaces/{workspaceId}', path);
}

const workspaceControllerUpdateOperation: OperationDefinition = {
  id: 'WorkspaceController_update',
  method: 'PATCH',
  path: '/workspaces/{workspaceId}',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: WorkspaceControllerUpdateSchemas,
};

export function workspaceControllerUpdate(
  input: WorkspaceControllerUpdateInput,
  options?: RequestOptions,
): Promise<WorkspaceControllerUpdateResult> {
  return request<WorkspaceControllerUpdateResult>(
    workspaceControllerUpdateOperation,
    input,
    options,
  );
}

// POST /workspaces/{workspaceId}/admins

export interface WorkspaceControllerAssignAdminPathParams {
  workspaceId: string;
}

export type WorkspaceControllerAssignAdminBody = AssignWorkspaceAdminRequest;

export interface WorkspaceControllerAssignAdminInput {
  path: WorkspaceControllerAssignAdminPathParams;
  body: WorkspaceControllerAssignAdminBody;
}

export interface WorkspaceControllerAssignAdminResponses {
  201: {
    data: WorkspaceDetail;
  };
}

export type WorkspaceControllerAssignAdminResponse = WorkspaceControllerAssignAdminResponses[201];

export type WorkspaceControllerAssignAdminResult = ApiResponse<
  201,
  WorkspaceControllerAssignAdminResponses[201]
>;

export const WorkspaceControllerAssignAdminSchemas = {
  path: z.object({
    workspaceId: z.string(),
  }),
  body: AssignWorkspaceAdminRequestSchema,
  responses: {
    201: z.object({
      data: WorkspaceDetailSchema,
    }),
  },
} satisfies OperationSchemas;

export function getWorkspaceControllerAssignAdminUrl(
  path: WorkspaceControllerAssignAdminPathParams,
): string {
  return buildUrl('/workspaces/{workspaceId}/admins', path);
}

const workspaceControllerAssignAdminOperation: OperationDefinition = {
  id: 'WorkspaceController_assignAdmin',
  method: 'POST',
  path: '/workspaces/{workspaceId}/admins',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 201: 'json' },
  schemas: WorkspaceControllerAssignAdminSchemas,
};

/** 指定管理員（加入成員並給 workspace-admin；留下稽核） */
export function workspaceControllerAssignAdmin(
  input: WorkspaceControllerAssignAdminInput,
  options?: RequestOptions,
): Promise<WorkspaceControllerAssignAdminResult> {
  return request<WorkspaceControllerAssignAdminResult>(
    workspaceControllerAssignAdminOperation,
    input,
    options,
  );
}

// GET /workspaces/{workspaceId}/me

export interface WorkspaceMemberControllerMePathParams {
  workspaceId: unknown;
}

export interface WorkspaceMemberControllerMeInput {
  path: WorkspaceMemberControllerMePathParams;
}

export interface WorkspaceMemberControllerMeResponses {
  200: {
    data: WorkspaceMe;
  };
}

export type WorkspaceMemberControllerMeResponse = WorkspaceMemberControllerMeResponses[200];

export type WorkspaceMemberControllerMeResult = ApiResponse<
  200,
  WorkspaceMemberControllerMeResponses[200]
>;

export const WorkspaceMemberControllerMeSchemas = {
  path: z.object({
    workspaceId: z.unknown(),
  }),
  responses: {
    200: z.object({
      data: WorkspaceMeSchema,
    }),
  },
} satisfies OperationSchemas;

export function getWorkspaceMemberControllerMeUrl(
  path: WorkspaceMemberControllerMePathParams,
): string {
  return buildUrl('/workspaces/{workspaceId}/me', path);
}

const workspaceMemberControllerMeOperation: OperationDefinition = {
  id: 'WorkspaceMemberController_me',
  method: 'GET',
  path: '/workspaces/{workspaceId}/me',
  responseTypes: { 200: 'json' },
  schemas: WorkspaceMemberControllerMeSchemas,
};

/** 自己在這個工作區的角色與權限鍵（進入工作區時呼叫） */
export function workspaceMemberControllerMe(
  input: WorkspaceMemberControllerMeInput,
  options?: RequestOptions,
): Promise<WorkspaceMemberControllerMeResult> {
  return request<WorkspaceMemberControllerMeResult>(
    workspaceMemberControllerMeOperation,
    input,
    options,
  );
}

// GET /workspaces/{workspaceId}/members

export interface WorkspaceMemberControllerListMembersPathParams {
  workspaceId: unknown;
}

export interface WorkspaceMemberControllerListMembersInput {
  path: WorkspaceMemberControllerListMembersPathParams;
}

export interface WorkspaceMemberControllerListMembersResponses {
  200: {
    data: {
      items: Array<WorkspaceMember>;
      pagination: {
        offset: number;
        limit: number;
        total: number;
      };
    };
  };
}

export type WorkspaceMemberControllerListMembersResponse =
  WorkspaceMemberControllerListMembersResponses[200];

export type WorkspaceMemberControllerListMembersResult = ApiResponse<
  200,
  WorkspaceMemberControllerListMembersResponses[200]
>;

export const WorkspaceMemberControllerListMembersSchemas = {
  path: z.object({
    workspaceId: z.unknown(),
  }),
  responses: {
    200: z.object({
      data: z.object({
        items: z.array(WorkspaceMemberSchema),
        pagination: z.object({
          offset: z.int(),
          limit: z.int(),
          total: z.int(),
        }),
      }),
    }),
  },
} satisfies OperationSchemas;

export function getWorkspaceMemberControllerListMembersUrl(
  path: WorkspaceMemberControllerListMembersPathParams,
): string {
  return buildUrl('/workspaces/{workspaceId}/members', path);
}

const workspaceMemberControllerListMembersOperation: OperationDefinition = {
  id: 'WorkspaceMemberController_listMembers',
  method: 'GET',
  path: '/workspaces/{workspaceId}/members',
  responseTypes: { 200: 'json' },
  schemas: WorkspaceMemberControllerListMembersSchemas,
};

export function workspaceMemberControllerListMembers(
  input: WorkspaceMemberControllerListMembersInput,
  options?: RequestOptions,
): Promise<WorkspaceMemberControllerListMembersResult> {
  return request<WorkspaceMemberControllerListMembersResult>(
    workspaceMemberControllerListMembersOperation,
    input,
    options,
  );
}

// PUT /workspaces/{workspaceId}/members/{userId}/roles

export interface WorkspaceMemberControllerUpdateRolesPathParams {
  userId: string;
  workspaceId: unknown;
}

export type WorkspaceMemberControllerUpdateRolesBody = UpdateWorkspaceMemberRolesRequest;

export interface WorkspaceMemberControllerUpdateRolesInput {
  path: WorkspaceMemberControllerUpdateRolesPathParams;
  body: WorkspaceMemberControllerUpdateRolesBody;
}

export interface WorkspaceMemberControllerUpdateRolesResponses {
  200: {
    data: WorkspaceMemberRoles;
  };
}

export type WorkspaceMemberControllerUpdateRolesResponse =
  WorkspaceMemberControllerUpdateRolesResponses[200];

export type WorkspaceMemberControllerUpdateRolesResult = ApiResponse<
  200,
  WorkspaceMemberControllerUpdateRolesResponses[200]
>;

export const WorkspaceMemberControllerUpdateRolesSchemas = {
  path: z.object({
    userId: z.string(),
    workspaceId: z.unknown(),
  }),
  body: UpdateWorkspaceMemberRolesRequestSchema,
  responses: {
    200: z.object({
      data: WorkspaceMemberRolesSchema,
    }),
  },
} satisfies OperationSchemas;

export function getWorkspaceMemberControllerUpdateRolesUrl(
  path: WorkspaceMemberControllerUpdateRolesPathParams,
): string {
  return buildUrl('/workspaces/{workspaceId}/members/{userId}/roles', path);
}

const workspaceMemberControllerUpdateRolesOperation: OperationDefinition = {
  id: 'WorkspaceMemberController_updateRoles',
  method: 'PUT',
  path: '/workspaces/{workspaceId}/members/{userId}/roles',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: WorkspaceMemberControllerUpdateRolesSchemas,
};

/** 整批取代成員的工作區角色（受反提權限制） */
export function workspaceMemberControllerUpdateRoles(
  input: WorkspaceMemberControllerUpdateRolesInput,
  options?: RequestOptions,
): Promise<WorkspaceMemberControllerUpdateRolesResult> {
  return request<WorkspaceMemberControllerUpdateRolesResult>(
    workspaceMemberControllerUpdateRolesOperation,
    input,
    options,
  );
}

// DELETE /workspaces/{workspaceId}/members/{userId}

export interface WorkspaceMemberControllerRemoveMemberPathParams {
  userId: string;
  workspaceId: unknown;
}

export interface WorkspaceMemberControllerRemoveMemberInput {
  path: WorkspaceMemberControllerRemoveMemberPathParams;
}

export interface WorkspaceMemberControllerRemoveMemberResponses {
  204: undefined;
}

export type WorkspaceMemberControllerRemoveMemberResponse =
  WorkspaceMemberControllerRemoveMemberResponses[204];

export type WorkspaceMemberControllerRemoveMemberResult = ApiResponse<
  204,
  WorkspaceMemberControllerRemoveMemberResponses[204]
>;

export const WorkspaceMemberControllerRemoveMemberSchemas = {
  path: z.object({
    userId: z.string(),
    workspaceId: z.unknown(),
  }),
} satisfies OperationSchemas;

export function getWorkspaceMemberControllerRemoveMemberUrl(
  path: WorkspaceMemberControllerRemoveMemberPathParams,
): string {
  return buildUrl('/workspaces/{workspaceId}/members/{userId}', path);
}

const workspaceMemberControllerRemoveMemberOperation: OperationDefinition = {
  id: 'WorkspaceMemberController_removeMember',
  method: 'DELETE',
  path: '/workspaces/{workspaceId}/members/{userId}',
  responseTypes: { 204: 'none' },
  schemas: WorkspaceMemberControllerRemoveMemberSchemas,
};

export function workspaceMemberControllerRemoveMember(
  input: WorkspaceMemberControllerRemoveMemberInput,
  options?: RequestOptions,
): Promise<WorkspaceMemberControllerRemoveMemberResult> {
  return request<WorkspaceMemberControllerRemoveMemberResult>(
    workspaceMemberControllerRemoveMemberOperation,
    input,
    options,
  );
}

// GET /workspaces/{workspaceId}/roles

export interface WorkspaceMemberControllerListRolesPathParams {
  workspaceId: unknown;
}

export interface WorkspaceMemberControllerListRolesInput {
  path: WorkspaceMemberControllerListRolesPathParams;
}

export interface WorkspaceMemberControllerListRolesResponses {
  200: {
    data: WorkspaceRoleList;
  };
}

export type WorkspaceMemberControllerListRolesResponse =
  WorkspaceMemberControllerListRolesResponses[200];

export type WorkspaceMemberControllerListRolesResult = ApiResponse<
  200,
  WorkspaceMemberControllerListRolesResponses[200]
>;

export const WorkspaceMemberControllerListRolesSchemas = {
  path: z.object({
    workspaceId: z.unknown(),
  }),
  responses: {
    200: z.object({
      data: WorkspaceRoleListSchema,
    }),
  },
} satisfies OperationSchemas;

export function getWorkspaceMemberControllerListRolesUrl(
  path: WorkspaceMemberControllerListRolesPathParams,
): string {
  return buildUrl('/workspaces/{workspaceId}/roles', path);
}

const workspaceMemberControllerListRolesOperation: OperationDefinition = {
  id: 'WorkspaceMemberController_listRoles',
  method: 'GET',
  path: '/workspaces/{workspaceId}/roles',
  responseTypes: { 200: 'json' },
  schemas: WorkspaceMemberControllerListRolesSchemas,
};

/** 可以指派的工作區角色（不需要平台的 role:read） */
export function workspaceMemberControllerListRoles(
  input: WorkspaceMemberControllerListRolesInput,
  options?: RequestOptions,
): Promise<WorkspaceMemberControllerListRolesResult> {
  return request<WorkspaceMemberControllerListRolesResult>(
    workspaceMemberControllerListRolesOperation,
    input,
    options,
  );
}
