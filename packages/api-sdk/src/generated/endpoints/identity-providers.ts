// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  CreateIdentityProviderRequest,
  IdentityProvider,
  IdentityProviderList,
  UpdateIdentityProviderRequest,
} from '../models';
import { buildUrl, request } from '../runtime';
import type {
  ApiResponse,
  OperationDefinition,
  OperationSchemas,
  RequestOptions,
} from '../runtime';
import {
  CreateIdentityProviderRequestSchema,
  IdentityProviderListSchema,
  IdentityProviderSchema,
  UpdateIdentityProviderRequestSchema,
} from '../schemas';

// GET /identity-providers

export interface IdentityProviderControllerListResponses {
  200: {
    data: IdentityProviderList;
  };
}

export type IdentityProviderControllerListResponse = IdentityProviderControllerListResponses[200];

export type IdentityProviderControllerListResult = ApiResponse<
  200,
  IdentityProviderControllerListResponses[200]
>;

export const IdentityProviderControllerListSchemas = {
  responses: {
    200: z.object({
      data: IdentityProviderListSchema,
    }),
  },
} satisfies OperationSchemas;

export function getIdentityProviderControllerListUrl(): string {
  return buildUrl('/identity-providers');
}

const identityProviderControllerListOperation: OperationDefinition = {
  id: 'IdentityProviderController_list',
  method: 'GET',
  path: '/identity-providers',
  responseTypes: { 200: 'json' },
  schemas: IdentityProviderControllerListSchemas,
};

/** 所有連線（不含 client secret）與要登記在外部 IdP 的 redirect URI */
export function identityProviderControllerList(
  options?: RequestOptions,
): Promise<IdentityProviderControllerListResult> {
  return request<IdentityProviderControllerListResult>(
    identityProviderControllerListOperation,
    {},
    options,
  );
}

// POST /identity-providers

export type IdentityProviderControllerCreateBody = CreateIdentityProviderRequest;

export interface IdentityProviderControllerCreateInput {
  body: IdentityProviderControllerCreateBody;
}

export interface IdentityProviderControllerCreateResponses {
  201: {
    data: IdentityProvider;
  };
}

export type IdentityProviderControllerCreateResponse =
  IdentityProviderControllerCreateResponses[201];

export type IdentityProviderControllerCreateResult = ApiResponse<
  201,
  IdentityProviderControllerCreateResponses[201]
>;

export const IdentityProviderControllerCreateSchemas = {
  body: CreateIdentityProviderRequestSchema,
  responses: {
    201: z.object({
      data: IdentityProviderSchema,
    }),
  },
} satisfies OperationSchemas;

export function getIdentityProviderControllerCreateUrl(): string {
  return buildUrl('/identity-providers');
}

const identityProviderControllerCreateOperation: OperationDefinition = {
  id: 'IdentityProviderController_create',
  method: 'POST',
  path: '/identity-providers',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 201: 'json' },
  schemas: IdentityProviderControllerCreateSchemas,
};

export function identityProviderControllerCreate(
  input: IdentityProviderControllerCreateInput,
  options?: RequestOptions,
): Promise<IdentityProviderControllerCreateResult> {
  return request<IdentityProviderControllerCreateResult>(
    identityProviderControllerCreateOperation,
    input,
    options,
  );
}

// DELETE /identity-providers/{id}

export interface IdentityProviderControllerRemovePathParams {
  id: string;
}

export interface IdentityProviderControllerRemoveInput {
  path: IdentityProviderControllerRemovePathParams;
}

export interface IdentityProviderControllerRemoveResponses {
  204: undefined;
}

export type IdentityProviderControllerRemoveResponse =
  IdentityProviderControllerRemoveResponses[204];

export type IdentityProviderControllerRemoveResult = ApiResponse<
  204,
  IdentityProviderControllerRemoveResponses[204]
>;

export const IdentityProviderControllerRemoveSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

export function getIdentityProviderControllerRemoveUrl(
  path: IdentityProviderControllerRemovePathParams,
): string {
  return buildUrl('/identity-providers/{id}', path);
}

const identityProviderControllerRemoveOperation: OperationDefinition = {
  id: 'IdentityProviderController_remove',
  method: 'DELETE',
  path: '/identity-providers/{id}',
  responseTypes: { 204: 'none' },
  schemas: IdentityProviderControllerRemoveSchemas,
};

export function identityProviderControllerRemove(
  input: IdentityProviderControllerRemoveInput,
  options?: RequestOptions,
): Promise<IdentityProviderControllerRemoveResult> {
  return request<IdentityProviderControllerRemoveResult>(
    identityProviderControllerRemoveOperation,
    input,
    options,
  );
}

// PATCH /identity-providers/{id}

export interface IdentityProviderControllerUpdatePathParams {
  id: string;
}

export type IdentityProviderControllerUpdateBody = UpdateIdentityProviderRequest;

export interface IdentityProviderControllerUpdateInput {
  path: IdentityProviderControllerUpdatePathParams;
  body: IdentityProviderControllerUpdateBody;
}

export interface IdentityProviderControllerUpdateResponses {
  200: {
    data: IdentityProvider;
  };
}

export type IdentityProviderControllerUpdateResponse =
  IdentityProviderControllerUpdateResponses[200];

export type IdentityProviderControllerUpdateResult = ApiResponse<
  200,
  IdentityProviderControllerUpdateResponses[200]
>;

export const IdentityProviderControllerUpdateSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: UpdateIdentityProviderRequestSchema,
  responses: {
    200: z.object({
      data: IdentityProviderSchema,
    }),
  },
} satisfies OperationSchemas;

export function getIdentityProviderControllerUpdateUrl(
  path: IdentityProviderControllerUpdatePathParams,
): string {
  return buildUrl('/identity-providers/{id}', path);
}

const identityProviderControllerUpdateOperation: OperationDefinition = {
  id: 'IdentityProviderController_update',
  method: 'PATCH',
  path: '/identity-providers/{id}',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: IdentityProviderControllerUpdateSchemas,
};

/** 更新；clientSecret 有給才更換，domains 有給就整批取代 */
export function identityProviderControllerUpdate(
  input: IdentityProviderControllerUpdateInput,
  options?: RequestOptions,
): Promise<IdentityProviderControllerUpdateResult> {
  return request<IdentityProviderControllerUpdateResult>(
    identityProviderControllerUpdateOperation,
    input,
    options,
  );
}
