// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  ApiTokenList,
  CreateApiTokenRequest,
  CreateServiceAccountRequest,
  CreatedApiToken,
  ReplaceServiceAccountRolesRequest,
  ServiceAccount,
  ServiceAccountRoles,
  UpdateServiceAccountRequest,
} from '../models';
import { buildUrl, request } from '../runtime';
import type {
  ApiResponse,
  OperationDefinition,
  OperationSchemas,
  RequestOptions,
} from '../runtime';
import {
  ApiTokenListSchema,
  CreateApiTokenRequestSchema,
  CreateServiceAccountRequestSchema,
  CreatedApiTokenSchema,
  ReplaceServiceAccountRolesRequestSchema,
  ServiceAccountRolesSchema,
  ServiceAccountSchema,
  UpdateServiceAccountRequestSchema,
} from '../schemas';

// GET /service-accounts

export interface ServiceAccountControllerListResponses {
  200: {
    data: {
      items: Array<ServiceAccount>;
      pagination: {
        offset: number;
        limit: number;
        total: number;
      };
    };
  };
}

export type ServiceAccountControllerListResponse = ServiceAccountControllerListResponses[200];

export type ServiceAccountControllerListResult = ApiResponse<
  200,
  ServiceAccountControllerListResponses[200]
>;

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

export function getServiceAccountControllerListUrl(): string {
  return buildUrl('/service-accounts');
}

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

export type ServiceAccountControllerCreateBody = CreateServiceAccountRequest;

export interface ServiceAccountControllerCreateInput {
  body: ServiceAccountControllerCreateBody;
}

export interface ServiceAccountControllerCreateResponses {
  201: {
    data: ServiceAccount;
  };
}

export type ServiceAccountControllerCreateResponse = ServiceAccountControllerCreateResponses[201];

export type ServiceAccountControllerCreateResult = ApiResponse<
  201,
  ServiceAccountControllerCreateResponses[201]
>;

export const ServiceAccountControllerCreateSchemas = {
  body: CreateServiceAccountRequestSchema,
  responses: {
    201: z.object({
      data: ServiceAccountSchema,
    }),
  },
} satisfies OperationSchemas;

export function getServiceAccountControllerCreateUrl(): string {
  return buildUrl('/service-accounts');
}

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

export interface ServiceAccountControllerFindOnePathParams {
  id: string;
}

export interface ServiceAccountControllerFindOneInput {
  path: ServiceAccountControllerFindOnePathParams;
}

export interface ServiceAccountControllerFindOneResponses {
  200: {
    data: ServiceAccount;
  };
}

export type ServiceAccountControllerFindOneResponse = ServiceAccountControllerFindOneResponses[200];

export type ServiceAccountControllerFindOneResult = ApiResponse<
  200,
  ServiceAccountControllerFindOneResponses[200]
>;

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

export function getServiceAccountControllerFindOneUrl(
  path: ServiceAccountControllerFindOnePathParams,
): string {
  return buildUrl('/service-accounts/{id}', path);
}

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

export interface ServiceAccountControllerRemovePathParams {
  id: string;
}

export interface ServiceAccountControllerRemoveInput {
  path: ServiceAccountControllerRemovePathParams;
}

export interface ServiceAccountControllerRemoveResponses {
  204: undefined;
}

export type ServiceAccountControllerRemoveResponse = ServiceAccountControllerRemoveResponses[204];

export type ServiceAccountControllerRemoveResult = ApiResponse<
  204,
  ServiceAccountControllerRemoveResponses[204]
>;

export const ServiceAccountControllerRemoveSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

export function getServiceAccountControllerRemoveUrl(
  path: ServiceAccountControllerRemovePathParams,
): string {
  return buildUrl('/service-accounts/{id}', path);
}

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

export interface ServiceAccountControllerUpdatePathParams {
  id: string;
}

export type ServiceAccountControllerUpdateBody = UpdateServiceAccountRequest;

export interface ServiceAccountControllerUpdateInput {
  path: ServiceAccountControllerUpdatePathParams;
  body: ServiceAccountControllerUpdateBody;
}

export interface ServiceAccountControllerUpdateResponses {
  200: {
    data: ServiceAccount;
  };
}

export type ServiceAccountControllerUpdateResponse = ServiceAccountControllerUpdateResponses[200];

export type ServiceAccountControllerUpdateResult = ApiResponse<
  200,
  ServiceAccountControllerUpdateResponses[200]
>;

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

export function getServiceAccountControllerUpdateUrl(
  path: ServiceAccountControllerUpdatePathParams,
): string {
  return buildUrl('/service-accounts/{id}', path);
}

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

export interface ServiceAccountControllerReplaceRolesPathParams {
  id: string;
}

export type ServiceAccountControllerReplaceRolesBody = ReplaceServiceAccountRolesRequest;

export interface ServiceAccountControllerReplaceRolesInput {
  path: ServiceAccountControllerReplaceRolesPathParams;
  body: ServiceAccountControllerReplaceRolesBody;
}

export interface ServiceAccountControllerReplaceRolesResponses {
  200: {
    data: ServiceAccountRoles;
  };
}

export type ServiceAccountControllerReplaceRolesResponse =
  ServiceAccountControllerReplaceRolesResponses[200];

export type ServiceAccountControllerReplaceRolesResult = ApiResponse<
  200,
  ServiceAccountControllerReplaceRolesResponses[200]
>;

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

export function getServiceAccountControllerReplaceRolesUrl(
  path: ServiceAccountControllerReplaceRolesPathParams,
): string {
  return buildUrl('/service-accounts/{id}/roles', path);
}

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

export interface ServiceAccountControllerListTokensPathParams {
  id: string;
}

export interface ServiceAccountControllerListTokensInput {
  path: ServiceAccountControllerListTokensPathParams;
}

export interface ServiceAccountControllerListTokensResponses {
  200: {
    data: ApiTokenList;
  };
}

export type ServiceAccountControllerListTokensResponse =
  ServiceAccountControllerListTokensResponses[200];

export type ServiceAccountControllerListTokensResult = ApiResponse<
  200,
  ServiceAccountControllerListTokensResponses[200]
>;

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

export function getServiceAccountControllerListTokensUrl(
  path: ServiceAccountControllerListTokensPathParams,
): string {
  return buildUrl('/service-accounts/{id}/tokens', path);
}

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

export interface ServiceAccountControllerCreateTokenPathParams {
  id: string;
}

export type ServiceAccountControllerCreateTokenBody = CreateApiTokenRequest;

export interface ServiceAccountControllerCreateTokenInput {
  path: ServiceAccountControllerCreateTokenPathParams;
  body: ServiceAccountControllerCreateTokenBody;
}

export interface ServiceAccountControllerCreateTokenResponses {
  201: {
    data: CreatedApiToken;
  };
}

export type ServiceAccountControllerCreateTokenResponse =
  ServiceAccountControllerCreateTokenResponses[201];

export type ServiceAccountControllerCreateTokenResult = ApiResponse<
  201,
  ServiceAccountControllerCreateTokenResponses[201]
>;

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

export function getServiceAccountControllerCreateTokenUrl(
  path: ServiceAccountControllerCreateTokenPathParams,
): string {
  return buildUrl('/service-accounts/{id}/tokens', path);
}

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

export interface ServiceAccountControllerRevokeTokenPathParams {
  id: string;
  tokenId: string;
}

export interface ServiceAccountControllerRevokeTokenInput {
  path: ServiceAccountControllerRevokeTokenPathParams;
}

export interface ServiceAccountControllerRevokeTokenResponses {
  204: undefined;
}

export type ServiceAccountControllerRevokeTokenResponse =
  ServiceAccountControllerRevokeTokenResponses[204];

export type ServiceAccountControllerRevokeTokenResult = ApiResponse<
  204,
  ServiceAccountControllerRevokeTokenResponses[204]
>;

export const ServiceAccountControllerRevokeTokenSchemas = {
  path: z.object({
    id: z.string(),
    tokenId: z.string(),
  }),
} satisfies OperationSchemas;

export function getServiceAccountControllerRevokeTokenUrl(
  path: ServiceAccountControllerRevokeTokenPathParams,
): string {
  return buildUrl('/service-accounts/{id}/tokens/{tokenId}', path);
}

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
