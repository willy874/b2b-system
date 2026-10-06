// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  ServiceAccountControllerCreateInput,
  ServiceAccountControllerCreateResult,
  ServiceAccountControllerCreateTokenInput,
  ServiceAccountControllerCreateTokenResult,
  ServiceAccountControllerFindOneInput,
  ServiceAccountControllerFindOneResult,
  ServiceAccountControllerListResult,
  ServiceAccountControllerListTokensInput,
  ServiceAccountControllerListTokensResult,
  ServiceAccountControllerRemoveInput,
  ServiceAccountControllerRemoveResult,
  ServiceAccountControllerReplaceRolesInput,
  ServiceAccountControllerReplaceRolesResult,
  ServiceAccountControllerRevokeTokenInput,
  ServiceAccountControllerRevokeTokenResult,
  ServiceAccountControllerUpdateInput,
  ServiceAccountControllerUpdateResult,
} from '../../endpoints/service-accounts';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';
import {
  ApiTokenListSchema,
  CreateApiTokenRequestSchema,
  CreateServiceAccountRequestSchema,
  CreatedApiTokenSchema,
  ReplaceServiceAccountRolesRequestSchema,
  ServiceAccountRolesSchema,
  ServiceAccountSchema,
  UpdateServiceAccountRequestSchema,
} from '../components';

// GET /service-accounts

export const ServiceAccountControllerListSchemas = {
  responses: {
    200: z.object({
      data: z.object({
        items: z.array(ServiceAccountSchema),
        pagination: z.object({
          offset: z.int(),
          limit: z.int(),
          total: z.int(),
        }),
      }),
    }),
  },
} satisfies OperationSchemas;

const serviceAccountControllerListOperation: OperationDefinition = {
  id: 'ServiceAccountController_list',
  method: 'GET',
  path: '/service-accounts',
  responseTypes: { 200: 'json' },
  schemas: ServiceAccountControllerListSchemas,
};

export function serviceAccountControllerList(
  options?: RequestOptions,
): Promise<ServiceAccountControllerListResult> {
  return request<ServiceAccountControllerListResult>(
    serviceAccountControllerListOperation,
    {},
    options,
  );
}

// POST /service-accounts

export const ServiceAccountControllerCreateSchemas = {
  body: CreateServiceAccountRequestSchema,
  responses: {
    201: z.object({
      data: ServiceAccountSchema,
    }),
  },
} satisfies OperationSchemas;

const serviceAccountControllerCreateOperation: OperationDefinition = {
  id: 'ServiceAccountController_create',
  method: 'POST',
  path: '/service-accounts',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 201: 'json' },
  schemas: ServiceAccountControllerCreateSchemas,
};

/** 建立服務帳號；指派的角色受反提權限制 */
export function serviceAccountControllerCreate(
  input: ServiceAccountControllerCreateInput,
  options?: RequestOptions,
): Promise<ServiceAccountControllerCreateResult> {
  return request<ServiceAccountControllerCreateResult>(
    serviceAccountControllerCreateOperation,
    input,
    options,
  );
}

// GET /service-accounts/{id}

export const ServiceAccountControllerFindOneSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: ServiceAccountSchema,
    }),
  },
} satisfies OperationSchemas;

const serviceAccountControllerFindOneOperation: OperationDefinition = {
  id: 'ServiceAccountController_findOne',
  method: 'GET',
  path: '/service-accounts/{id}',
  responseTypes: { 200: 'json' },
  schemas: ServiceAccountControllerFindOneSchemas,
};

export function serviceAccountControllerFindOne(
  input: ServiceAccountControllerFindOneInput,
  options?: RequestOptions,
): Promise<ServiceAccountControllerFindOneResult> {
  return request<ServiceAccountControllerFindOneResult>(
    serviceAccountControllerFindOneOperation,
    input,
    options,
  );
}

// DELETE /service-accounts/{id}

export const ServiceAccountControllerRemoveSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

const serviceAccountControllerRemoveOperation: OperationDefinition = {
  id: 'ServiceAccountController_remove',
  method: 'DELETE',
  path: '/service-accounts/{id}',
  responseTypes: { 204: 'none' },
  schemas: ServiceAccountControllerRemoveSchemas,
};

/** 刪除；它的 token 一併失效，不進回收桶 */
export function serviceAccountControllerRemove(
  input: ServiceAccountControllerRemoveInput,
  options?: RequestOptions,
): Promise<ServiceAccountControllerRemoveResult> {
  return request<ServiceAccountControllerRemoveResult>(
    serviceAccountControllerRemoveOperation,
    input,
    options,
  );
}

// PATCH /service-accounts/{id}

export const ServiceAccountControllerUpdateSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: UpdateServiceAccountRequestSchema,
  responses: {
    200: z.object({
      data: ServiceAccountSchema,
    }),
  },
} satisfies OperationSchemas;

const serviceAccountControllerUpdateOperation: OperationDefinition = {
  id: 'ServiceAccountController_update',
  method: 'PATCH',
  path: '/service-accounts/{id}',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: ServiceAccountControllerUpdateSchemas,
};

/** 改名、停用、啟用；停用時它的 token 全部失效 */
export function serviceAccountControllerUpdate(
  input: ServiceAccountControllerUpdateInput,
  options?: RequestOptions,
): Promise<ServiceAccountControllerUpdateResult> {
  return request<ServiceAccountControllerUpdateResult>(
    serviceAccountControllerUpdateOperation,
    input,
    options,
  );
}

// PUT /service-accounts/{id}/roles

export const ServiceAccountControllerReplaceRolesSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: ReplaceServiceAccountRolesRequestSchema,
  responses: {
    200: z.object({
      data: ServiceAccountRolesSchema,
    }),
  },
} satisfies OperationSchemas;

const serviceAccountControllerReplaceRolesOperation: OperationDefinition = {
  id: 'ServiceAccountController_replaceRoles',
  method: 'PUT',
  path: '/service-accounts/{id}/roles',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: ServiceAccountControllerReplaceRolesSchemas,
};

/** 整批取代持有的角色；受反提權限制 */
export function serviceAccountControllerReplaceRoles(
  input: ServiceAccountControllerReplaceRolesInput,
  options?: RequestOptions,
): Promise<ServiceAccountControllerReplaceRolesResult> {
  return request<ServiceAccountControllerReplaceRolesResult>(
    serviceAccountControllerReplaceRolesOperation,
    input,
    options,
  );
}

// GET /service-accounts/{id}/tokens

export const ServiceAccountControllerListTokensSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: ApiTokenListSchema,
    }),
  },
} satisfies OperationSchemas;

const serviceAccountControllerListTokensOperation: OperationDefinition = {
  id: 'ServiceAccountController_listTokens',
  method: 'GET',
  path: '/service-accounts/{id}/tokens',
  responseTypes: { 200: 'json' },
  schemas: ServiceAccountControllerListTokensSchemas,
};

/** 它的 API token（含已撤銷、已過期；不含 secret） */
export function serviceAccountControllerListTokens(
  input: ServiceAccountControllerListTokensInput,
  options?: RequestOptions,
): Promise<ServiceAccountControllerListTokensResult> {
  return request<ServiceAccountControllerListTokensResult>(
    serviceAccountControllerListTokensOperation,
    input,
    options,
  );
}

// POST /service-accounts/{id}/tokens

export const ServiceAccountControllerCreateTokenSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: CreateApiTokenRequestSchema,
  responses: {
    201: z.object({
      data: CreatedApiTokenSchema,
    }),
  },
} satisfies OperationSchemas;

const serviceAccountControllerCreateTokenOperation: OperationDefinition = {
  id: 'ServiceAccountController_createToken',
  method: 'POST',
  path: '/service-accounts/{id}/tokens',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 201: 'json' },
  schemas: ServiceAccountControllerCreateTokenSchemas,
};

/** 替它建立 API token；回應的 token 只出現這一次。token 的有效權限必須是操作者持有的 */
export function serviceAccountControllerCreateToken(
  input: ServiceAccountControllerCreateTokenInput,
  options?: RequestOptions,
): Promise<ServiceAccountControllerCreateTokenResult> {
  return request<ServiceAccountControllerCreateTokenResult>(
    serviceAccountControllerCreateTokenOperation,
    input,
    options,
  );
}

// DELETE /service-accounts/{id}/tokens/{tokenId}

export const ServiceAccountControllerRevokeTokenSchemas = {
  path: z.object({
    id: z.string(),
    tokenId: z.string(),
  }),
} satisfies OperationSchemas;

const serviceAccountControllerRevokeTokenOperation: OperationDefinition = {
  id: 'ServiceAccountController_revokeToken',
  method: 'DELETE',
  path: '/service-accounts/{id}/tokens/{tokenId}',
  responseTypes: { 204: 'none' },
  schemas: ServiceAccountControllerRevokeTokenSchemas,
};

/** 撤銷它的一把 API token */
export function serviceAccountControllerRevokeToken(
  input: ServiceAccountControllerRevokeTokenInput,
  options?: RequestOptions,
): Promise<ServiceAccountControllerRevokeTokenResult> {
  return request<ServiceAccountControllerRevokeTokenResult>(
    serviceAccountControllerRevokeTokenOperation,
    input,
    options,
  );
}
