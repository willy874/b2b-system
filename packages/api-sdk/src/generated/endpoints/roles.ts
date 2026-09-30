// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

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
import { buildUrl, request } from '../runtime';
import type {
  ApiResponse,
  OperationDefinition,
  OperationSchemas,
  RequestOptions,
} from '../runtime';
import {
  CreateRoleRequestSchema,
  DuplicateRoleRequestSchema,
  RestoredRoleSchema,
  RevertRoleRevisionRequestSchema,
  RevisionSummarySchema,
  RoleHolderSchema,
  RolePermissionsSchema,
  RoleRevisionSchema,
  RoleSchema,
  UpdateRolePermissionsRequestSchema,
  UpdateRoleRequestSchema,
} from '../schemas';

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

export const RoleControllerListSchemas = {
  responses: {
    200: z.object({
      data: z.object({
        items: z.array(RoleSchema),
        pagination: z.object({
          offset: z.int(),
          limit: z.int(),
          total: z.int(),
        }),
      }),
    }),
  },
} satisfies OperationSchemas;

export function getRoleControllerListUrl(): string {
  return buildUrl('/roles');
}

const roleControllerListOperation: OperationDefinition = {
  id: 'RoleController_list',
  method: 'GET',
  path: '/roles',
  responseTypes: { 200: 'json' },
  schemas: RoleControllerListSchemas,
};

export function roleControllerList(options?: RequestOptions): Promise<RoleControllerListResult> {
  return request<RoleControllerListResult>(roleControllerListOperation, {}, options);
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

export const RoleControllerCreateSchemas = {
  body: CreateRoleRequestSchema,
  responses: {
    201: z.object({
      data: RoleSchema,
    }),
  },
} satisfies OperationSchemas;

export function getRoleControllerCreateUrl(): string {
  return buildUrl('/roles');
}

const roleControllerCreateOperation: OperationDefinition = {
  id: 'RoleController_create',
  method: 'POST',
  path: '/roles',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 201: 'json' },
  schemas: RoleControllerCreateSchemas,
};

export function roleControllerCreate(
  input: RoleControllerCreateInput,
  options?: RequestOptions,
): Promise<RoleControllerCreateResult> {
  return request<RoleControllerCreateResult>(roleControllerCreateOperation, input, options);
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

export const RoleControllerFindOneSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: RoleSchema,
    }),
  },
} satisfies OperationSchemas;

export function getRoleControllerFindOneUrl(path: RoleControllerFindOnePathParams): string {
  return buildUrl('/roles/{id}', path);
}

const roleControllerFindOneOperation: OperationDefinition = {
  id: 'RoleController_findOne',
  method: 'GET',
  path: '/roles/{id}',
  responseTypes: { 200: 'json' },
  schemas: RoleControllerFindOneSchemas,
};

export function roleControllerFindOne(
  input: RoleControllerFindOneInput,
  options?: RequestOptions,
): Promise<RoleControllerFindOneResult> {
  return request<RoleControllerFindOneResult>(roleControllerFindOneOperation, input, options);
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

export const RoleControllerRemoveSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

export function getRoleControllerRemoveUrl(path: RoleControllerRemovePathParams): string {
  return buildUrl('/roles/{id}', path);
}

const roleControllerRemoveOperation: OperationDefinition = {
  id: 'RoleController_remove',
  method: 'DELETE',
  path: '/roles/{id}',
  responseTypes: { 204: 'none' },
  schemas: RoleControllerRemoveSchemas,
};

export function roleControllerRemove(
  input: RoleControllerRemoveInput,
  options?: RequestOptions,
): Promise<RoleControllerRemoveResult> {
  return request<RoleControllerRemoveResult>(roleControllerRemoveOperation, input, options);
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

export const RoleControllerUpdateSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: UpdateRoleRequestSchema,
  responses: {
    200: z.object({
      data: RoleSchema,
    }),
  },
} satisfies OperationSchemas;

export function getRoleControllerUpdateUrl(path: RoleControllerUpdatePathParams): string {
  return buildUrl('/roles/{id}', path);
}

const roleControllerUpdateOperation: OperationDefinition = {
  id: 'RoleController_update',
  method: 'PATCH',
  path: '/roles/{id}',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: RoleControllerUpdateSchemas,
};

export function roleControllerUpdate(
  input: RoleControllerUpdateInput,
  options?: RequestOptions,
): Promise<RoleControllerUpdateResult> {
  return request<RoleControllerUpdateResult>(roleControllerUpdateOperation, input, options);
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

export const RoleControllerRestoreSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: RestoredRoleSchema,
    }),
  },
} satisfies OperationSchemas;

export function getRoleControllerRestoreUrl(path: RoleControllerRestorePathParams): string {
  return buildUrl('/roles/{id}/restore', path);
}

const roleControllerRestoreOperation: OperationDefinition = {
  id: 'RoleController_restore',
  method: 'POST',
  path: '/roles/{id}/restore',
  responseTypes: { 200: 'json' },
  schemas: RoleControllerRestoreSchemas,
};

/** 還原刪除的角色（原本的持有者一併恢復） */
export function roleControllerRestore(
  input: RoleControllerRestoreInput,
  options?: RequestOptions,
): Promise<RoleControllerRestoreResult> {
  return request<RoleControllerRestoreResult>(roleControllerRestoreOperation, input, options);
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

export const RoleControllerListRevisionsSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: z.object({
        items: z.array(RevisionSummarySchema),
        pagination: z.object({
          offset: z.int(),
          limit: z.int(),
          total: z.int(),
        }),
      }),
    }),
  },
} satisfies OperationSchemas;

export function getRoleControllerListRevisionsUrl(
  path: RoleControllerListRevisionsPathParams,
): string {
  return buildUrl('/roles/{id}/revisions', path);
}

const roleControllerListRevisionsOperation: OperationDefinition = {
  id: 'RoleController_listRevisions',
  method: 'GET',
  path: '/roles/{id}/revisions',
  responseTypes: { 200: 'json' },
  schemas: RoleControllerListRevisionsSchemas,
};

/** 角色的版本歷史（新的在前） */
export function roleControllerListRevisions(
  input: RoleControllerListRevisionsInput,
  options?: RequestOptions,
): Promise<RoleControllerListRevisionsResult> {
  return request<RoleControllerListRevisionsResult>(
    roleControllerListRevisionsOperation,
    input,
    options,
  );
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

export const RoleControllerGetRevisionSchemas = {
  path: z.object({
    id: z.string(),
    version: z.number(),
  }),
  responses: {
    200: z.object({
      data: RoleRevisionSchema,
    }),
  },
} satisfies OperationSchemas;

export function getRoleControllerGetRevisionUrl(path: RoleControllerGetRevisionPathParams): string {
  return buildUrl('/roles/{id}/revisions/{version}', path);
}

const roleControllerGetRevisionOperation: OperationDefinition = {
  id: 'RoleController_getRevision',
  method: 'GET',
  path: '/roles/{id}/revisions/{version}',
  responseTypes: { 200: 'json' },
  schemas: RoleControllerGetRevisionSchemas,
};

/** 角色的某一版（含快照） */
export function roleControllerGetRevision(
  input: RoleControllerGetRevisionInput,
  options?: RequestOptions,
): Promise<RoleControllerGetRevisionResult> {
  return request<RoleControllerGetRevisionResult>(
    roleControllerGetRevisionOperation,
    input,
    options,
  );
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

export const RoleControllerRevertToRevisionSchemas = {
  path: z.object({
    id: z.string(),
    version: z.number(),
  }),
  body: RevertRoleRevisionRequestSchema,
  responses: {
    200: z.object({
      data: RoleSchema,
    }),
  },
} satisfies OperationSchemas;

export function getRoleControllerRevertToRevisionUrl(
  path: RoleControllerRevertToRevisionPathParams,
): string {
  return buildUrl('/roles/{id}/revisions/{version}/revert', path);
}

const roleControllerRevertToRevisionOperation: OperationDefinition = {
  id: 'RoleController_revertToRevision',
  method: 'POST',
  path: '/roles/{id}/revisions/{version}/revert',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: RoleControllerRevertToRevisionSchemas,
};

/** 把角色還原到某一版（產生新的一版） */
export function roleControllerRevertToRevision(
  input: RoleControllerRevertToRevisionInput,
  options?: RequestOptions,
): Promise<RoleControllerRevertToRevisionResult> {
  return request<RoleControllerRevertToRevisionResult>(
    roleControllerRevertToRevisionOperation,
    input,
    options,
  );
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

export const RoleControllerListPermissionsSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: RolePermissionsSchema,
    }),
  },
} satisfies OperationSchemas;

export function getRoleControllerListPermissionsUrl(
  path: RoleControllerListPermissionsPathParams,
): string {
  return buildUrl('/roles/{id}/permissions', path);
}

const roleControllerListPermissionsOperation: OperationDefinition = {
  id: 'RoleController_listPermissions',
  method: 'GET',
  path: '/roles/{id}/permissions',
  responseTypes: { 200: 'json' },
  schemas: RoleControllerListPermissionsSchemas,
};

export function roleControllerListPermissions(
  input: RoleControllerListPermissionsInput,
  options?: RequestOptions,
): Promise<RoleControllerListPermissionsResult> {
  return request<RoleControllerListPermissionsResult>(
    roleControllerListPermissionsOperation,
    input,
    options,
  );
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

export const RoleControllerUpdatePermissionsSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: UpdateRolePermissionsRequestSchema,
  responses: {
    200: z.object({
      data: RolePermissionsSchema,
    }),
  },
} satisfies OperationSchemas;

export function getRoleControllerUpdatePermissionsUrl(
  path: RoleControllerUpdatePermissionsPathParams,
): string {
  return buildUrl('/roles/{id}/permissions', path);
}

const roleControllerUpdatePermissionsOperation: OperationDefinition = {
  id: 'RoleController_updatePermissions',
  method: 'PATCH',
  path: '/roles/{id}/permissions',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: RoleControllerUpdatePermissionsSchemas,
};

/** 增減角色權限（差異語意） */
export function roleControllerUpdatePermissions(
  input: RoleControllerUpdatePermissionsInput,
  options?: RequestOptions,
): Promise<RoleControllerUpdatePermissionsResult> {
  return request<RoleControllerUpdatePermissionsResult>(
    roleControllerUpdatePermissionsOperation,
    input,
    options,
  );
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

export const RoleControllerListUsersSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: z.object({
        items: z.array(RoleHolderSchema),
        pagination: z.object({
          offset: z.int(),
          limit: z.int(),
          total: z.int(),
        }),
      }),
    }),
  },
} satisfies OperationSchemas;

export function getRoleControllerListUsersUrl(path: RoleControllerListUsersPathParams): string {
  return buildUrl('/roles/{id}/users', path);
}

const roleControllerListUsersOperation: OperationDefinition = {
  id: 'RoleController_listUsers',
  method: 'GET',
  path: '/roles/{id}/users',
  responseTypes: { 200: 'json' },
  schemas: RoleControllerListUsersSchemas,
};

export function roleControllerListUsers(
  input: RoleControllerListUsersInput,
  options?: RequestOptions,
): Promise<RoleControllerListUsersResult> {
  return request<RoleControllerListUsersResult>(roleControllerListUsersOperation, input, options);
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

export const RoleControllerDuplicateSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: DuplicateRoleRequestSchema,
  responses: {
    201: z.object({
      data: RoleSchema,
    }),
  },
} satisfies OperationSchemas;

export function getRoleControllerDuplicateUrl(path: RoleControllerDuplicatePathParams): string {
  return buildUrl('/roles/{id}/duplicate', path);
}

const roleControllerDuplicateOperation: OperationDefinition = {
  id: 'RoleController_duplicate',
  method: 'POST',
  path: '/roles/{id}/duplicate',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 201: 'json' },
  schemas: RoleControllerDuplicateSchemas,
};

/** 以既有角色為範本建立新角色（受反提權限制） */
export function roleControllerDuplicate(
  input: RoleControllerDuplicateInput,
  options?: RequestOptions,
): Promise<RoleControllerDuplicateResult> {
  return request<RoleControllerDuplicateResult>(roleControllerDuplicateOperation, input, options);
}
