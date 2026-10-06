// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  RoleControllerCreateInput,
  RoleControllerCreateResult,
  RoleControllerDuplicateInput,
  RoleControllerDuplicateResult,
  RoleControllerFindOneInput,
  RoleControllerFindOneResult,
  RoleControllerGetRevisionInput,
  RoleControllerGetRevisionResult,
  RoleControllerListPermissionsInput,
  RoleControllerListPermissionsResult,
  RoleControllerListResult,
  RoleControllerListRevisionsInput,
  RoleControllerListRevisionsResult,
  RoleControllerListUsersInput,
  RoleControllerListUsersResult,
  RoleControllerRemoveInput,
  RoleControllerRemoveResult,
  RoleControllerRestoreInput,
  RoleControllerRestoreResult,
  RoleControllerRevertToRevisionInput,
  RoleControllerRevertToRevisionResult,
  RoleControllerUpdateInput,
  RoleControllerUpdatePermissionsInput,
  RoleControllerUpdatePermissionsResult,
  RoleControllerUpdateResult,
} from '../../endpoints/roles';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';
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
} from '../components';

// GET /roles

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

export const RoleControllerCreateSchemas = {
  body: CreateRoleRequestSchema,
  responses: {
    201: z.object({
      data: RoleSchema,
    }),
  },
} satisfies OperationSchemas;

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

export const RoleControllerRemoveSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

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
