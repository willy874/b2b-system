// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  TagControllerCreateInput,
  TagControllerCreateResult,
  TagControllerListResult,
  TagControllerRemoveInput,
  TagControllerRemoveResult,
  TagControllerReplaceInput,
  TagControllerReplaceResult,
  TagControllerUpdateInput,
  TagControllerUpdateResult,
} from '../../endpoints/tags';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';
import {
  CreateTagRequestSchema,
  ReplaceResourceTagsRequestSchema,
  ResourceTagsSchema,
  TagListSchema,
  TagSchema,
  UpdateTagRequestSchema,
} from '../components';

// GET /tags

export const TagControllerListSchemas = {
  responses: {
    200: z.object({
      data: TagListSchema,
    }),
  },
} satisfies OperationSchemas;

const tagControllerListOperation: OperationDefinition = {
  id: 'TagController_list',
  method: 'GET',
  path: '/tags',
  responseTypes: { 200: 'json' },
  schemas: TagControllerListSchemas,
};

/** 一個標籤組的標籤；要進得了那個標籤組（例：file 組要能進檔案管理器） */
export function tagControllerList(options?: RequestOptions): Promise<TagControllerListResult> {
  return request<TagControllerListResult>(tagControllerListOperation, {}, options);
}

// POST /tags

export const TagControllerCreateSchemas = {
  body: CreateTagRequestSchema,
  responses: {
    201: z.object({
      data: TagSchema,
    }),
  },
} satisfies OperationSchemas;

const tagControllerCreateOperation: OperationDefinition = {
  id: 'TagController_create',
  method: 'POST',
  path: '/tags',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 201: 'json' },
  schemas: TagControllerCreateSchemas,
};

export function tagControllerCreate(
  input: TagControllerCreateInput,
  options?: RequestOptions,
): Promise<TagControllerCreateResult> {
  return request<TagControllerCreateResult>(tagControllerCreateOperation, input, options);
}

// DELETE /tags/{id}

export const TagControllerRemoveSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

const tagControllerRemoveOperation: OperationDefinition = {
  id: 'TagController_remove',
  method: 'DELETE',
  path: '/tags/{id}',
  responseTypes: { 204: 'none' },
  schemas: TagControllerRemoveSchemas,
};

/** 刪除；所有資源上的這個標籤一併移除，不進回收桶 */
export function tagControllerRemove(
  input: TagControllerRemoveInput,
  options?: RequestOptions,
): Promise<TagControllerRemoveResult> {
  return request<TagControllerRemoveResult>(tagControllerRemoveOperation, input, options);
}

// PATCH /tags/{id}

export const TagControllerUpdateSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: UpdateTagRequestSchema,
  responses: {
    200: z.object({
      data: TagSchema,
    }),
  },
} satisfies OperationSchemas;

const tagControllerUpdateOperation: OperationDefinition = {
  id: 'TagController_update',
  method: 'PATCH',
  path: '/tags/{id}',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: TagControllerUpdateSchemas,
};

/** 改名、改色；標籤組不能改 */
export function tagControllerUpdate(
  input: TagControllerUpdateInput,
  options?: RequestOptions,
): Promise<TagControllerUpdateResult> {
  return request<TagControllerUpdateResult>(tagControllerUpdateOperation, input, options);
}

// PUT /tags/assignments/{resourceType}/{resourceId}

export const TagControllerReplaceSchemas = {
  path: z.object({
    resourceType: z.string(),
    resourceId: z.string(),
  }),
  body: ReplaceResourceTagsRequestSchema,
  responses: {
    200: z.object({
      data: ResourceTagsSchema,
    }),
  },
} satisfies OperationSchemas;

const tagControllerReplaceOperation: OperationDefinition = {
  id: 'TagController_replace',
  method: 'PUT',
  path: '/tags/assignments/{resourceType}/{resourceId}',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: TagControllerReplaceSchemas,
};

/** 整批取代一個資源的標籤；能不能改跟著那個資源的編輯權限 */
export function tagControllerReplace(
  input: TagControllerReplaceInput,
  options?: RequestOptions,
): Promise<TagControllerReplaceResult> {
  return request<TagControllerReplaceResult>(tagControllerReplaceOperation, input, options);
}
