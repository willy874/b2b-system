// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  IdentityProviderControllerCreateInput,
  IdentityProviderControllerCreateResult,
  IdentityProviderControllerListResult,
  IdentityProviderControllerRemoveInput,
  IdentityProviderControllerRemoveResult,
  IdentityProviderControllerUpdateInput,
  IdentityProviderControllerUpdateResult,
} from '../../endpoints/identity-providers';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';
import {
  CreateIdentityProviderRequestSchema,
  IdentityProviderListSchema,
  IdentityProviderSchema,
  UpdateIdentityProviderRequestSchema,
} from '../components';

// GET /identity-providers

export const IdentityProviderControllerListSchemas = {
  responses: {
    200: z.object({
      data: IdentityProviderListSchema,
    }),
  },
} satisfies OperationSchemas;

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

export const IdentityProviderControllerCreateSchemas = {
  body: CreateIdentityProviderRequestSchema,
  responses: {
    201: z.object({
      data: IdentityProviderSchema,
    }),
  },
} satisfies OperationSchemas;

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

export const IdentityProviderControllerRemoveSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

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
