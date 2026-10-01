// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type { ApiTokenList, CreateApiTokenRequest, CreatedApiToken } from '../models';
import { buildUrl, request } from '../runtime';
import type {
  ApiResponse,
  OperationDefinition,
  OperationSchemas,
  RequestOptions,
} from '../runtime';
import { ApiTokenListSchema, CreateApiTokenRequestSchema, CreatedApiTokenSchema } from '../schemas';

// GET /auth/api-tokens

export interface ApiTokenControllerListResponses {
  200: {
    data: ApiTokenList;
  };
}

export type ApiTokenControllerListResponse = ApiTokenControllerListResponses[200];

export type ApiTokenControllerListResult = ApiResponse<200, ApiTokenControllerListResponses[200]>;

export const ApiTokenControllerListSchemas = {
  responses: {
    200: z.object({
      data: ApiTokenListSchema,
    }),
  },
} satisfies OperationSchemas;

export function getApiTokenControllerListUrl(): string {
  return buildUrl('/auth/api-tokens');
}

const apiTokenControllerListOperation: OperationDefinition = {
  id: 'ApiTokenController_list',
  method: 'GET',
  path: '/auth/api-tokens',
  responseTypes: { 200: 'json' },
  schemas: ApiTokenControllerListSchemas,
};

/** 我的個人 API token（含已撤銷、已過期；不含 secret） */
export function apiTokenControllerList(
  options?: RequestOptions,
): Promise<ApiTokenControllerListResult> {
  return request<ApiTokenControllerListResult>(apiTokenControllerListOperation, {}, options);
}

// POST /auth/api-tokens

export type ApiTokenControllerCreateBody = CreateApiTokenRequest;

export interface ApiTokenControllerCreateInput {
  body: ApiTokenControllerCreateBody;
}

export interface ApiTokenControllerCreateResponses {
  201: {
    data: CreatedApiToken;
  };
}

export type ApiTokenControllerCreateResponse = ApiTokenControllerCreateResponses[201];

export type ApiTokenControllerCreateResult = ApiResponse<
  201,
  ApiTokenControllerCreateResponses[201]
>;

export const ApiTokenControllerCreateSchemas = {
  body: CreateApiTokenRequestSchema,
  responses: {
    201: z.object({
      data: CreatedApiTokenSchema,
    }),
  },
} satisfies OperationSchemas;

export function getApiTokenControllerCreateUrl(): string {
  return buildUrl('/auth/api-tokens');
}

const apiTokenControllerCreateOperation: OperationDefinition = {
  id: 'ApiTokenController_create',
  method: 'POST',
  path: '/auth/api-tokens',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 201: 'json' },
  schemas: ApiTokenControllerCreateSchemas,
};

/** 建立個人 API token；回應的 token 只出現這一次 */
export function apiTokenControllerCreate(
  input: ApiTokenControllerCreateInput,
  options?: RequestOptions,
): Promise<ApiTokenControllerCreateResult> {
  return request<ApiTokenControllerCreateResult>(apiTokenControllerCreateOperation, input, options);
}

// DELETE /auth/api-tokens/{tokenId}

export interface ApiTokenControllerRevokePathParams {
  tokenId: string;
}

export interface ApiTokenControllerRevokeInput {
  path: ApiTokenControllerRevokePathParams;
}

export interface ApiTokenControllerRevokeResponses {
  204: undefined;
}

export type ApiTokenControllerRevokeResponse = ApiTokenControllerRevokeResponses[204];

export type ApiTokenControllerRevokeResult = ApiResponse<
  204,
  ApiTokenControllerRevokeResponses[204]
>;

export const ApiTokenControllerRevokeSchemas = {
  path: z.object({
    tokenId: z.string(),
  }),
} satisfies OperationSchemas;

export function getApiTokenControllerRevokeUrl(path: ApiTokenControllerRevokePathParams): string {
  return buildUrl('/auth/api-tokens/{tokenId}', path);
}

const apiTokenControllerRevokeOperation: OperationDefinition = {
  id: 'ApiTokenController_revoke',
  method: 'DELETE',
  path: '/auth/api-tokens/{tokenId}',
  responseTypes: { 204: 'none' },
  schemas: ApiTokenControllerRevokeSchemas,
};

/** 撤銷自己的個人 API token */
export function apiTokenControllerRevoke(
  input: ApiTokenControllerRevokeInput,
  options?: RequestOptions,
): Promise<ApiTokenControllerRevokeResult> {
  return request<ApiTokenControllerRevokeResult>(apiTokenControllerRevokeOperation, input, options);
}

// GET /users/{userId}/api-tokens

export interface UserApiTokenControllerListPathParams {
  userId: string;
}

export interface UserApiTokenControllerListInput {
  path: UserApiTokenControllerListPathParams;
}

export interface UserApiTokenControllerListResponses {
  200: {
    data: ApiTokenList;
  };
}

export type UserApiTokenControllerListResponse = UserApiTokenControllerListResponses[200];

export type UserApiTokenControllerListResult = ApiResponse<
  200,
  UserApiTokenControllerListResponses[200]
>;

export const UserApiTokenControllerListSchemas = {
  path: z.object({
    userId: z.string(),
  }),
  responses: {
    200: z.object({
      data: ApiTokenListSchema,
    }),
  },
} satisfies OperationSchemas;

export function getUserApiTokenControllerListUrl(
  path: UserApiTokenControllerListPathParams,
): string {
  return buildUrl('/users/{userId}/api-tokens', path);
}

const userApiTokenControllerListOperation: OperationDefinition = {
  id: 'UserApiTokenController_list',
  method: 'GET',
  path: '/users/{userId}/api-tokens',
  responseTypes: { 200: 'json' },
  schemas: UserApiTokenControllerListSchemas,
};

/** 這位使用者的個人 API token（不含 secret） */
export function userApiTokenControllerList(
  input: UserApiTokenControllerListInput,
  options?: RequestOptions,
): Promise<UserApiTokenControllerListResult> {
  return request<UserApiTokenControllerListResult>(
    userApiTokenControllerListOperation,
    input,
    options,
  );
}

// DELETE /users/{userId}/api-tokens/{tokenId}

export interface UserApiTokenControllerRevokePathParams {
  userId: string;
  tokenId: string;
}

export interface UserApiTokenControllerRevokeInput {
  path: UserApiTokenControllerRevokePathParams;
}

export interface UserApiTokenControllerRevokeResponses {
  204: undefined;
}

export type UserApiTokenControllerRevokeResponse = UserApiTokenControllerRevokeResponses[204];

export type UserApiTokenControllerRevokeResult = ApiResponse<
  204,
  UserApiTokenControllerRevokeResponses[204]
>;

export const UserApiTokenControllerRevokeSchemas = {
  path: z.object({
    userId: z.string(),
    tokenId: z.string(),
  }),
} satisfies OperationSchemas;

export function getUserApiTokenControllerRevokeUrl(
  path: UserApiTokenControllerRevokePathParams,
): string {
  return buildUrl('/users/{userId}/api-tokens/{tokenId}', path);
}

const userApiTokenControllerRevokeOperation: OperationDefinition = {
  id: 'UserApiTokenController_revoke',
  method: 'DELETE',
  path: '/users/{userId}/api-tokens/{tokenId}',
  responseTypes: { 204: 'none' },
  schemas: UserApiTokenControllerRevokeSchemas,
};

/** 撤銷這位使用者的個人 API token */
export function userApiTokenControllerRevoke(
  input: UserApiTokenControllerRevokeInput,
  options?: RequestOptions,
): Promise<UserApiTokenControllerRevokeResult> {
  return request<UserApiTokenControllerRevokeResult>(
    userApiTokenControllerRevokeOperation,
    input,
    options,
  );
}
