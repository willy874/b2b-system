// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  CreateTagRequest,
  ReplaceResourceTagsRequest,
  ResourceTags,
  Tag,
  TagList,
  UpdateTagRequest,
} from '../models';
import { buildUrl, request } from '../runtime';
import type {
  ApiResponse,
  OperationDefinition,
  OperationSchemas,
  RequestOptions,
} from '../runtime';
import {
  CreateTagRequestSchema,
  ReplaceResourceTagsRequestSchema,
  ResourceTagsSchema,
  TagListSchema,
  TagSchema,
  UpdateTagRequestSchema,
} from '../schemas';

// GET /tags

export interface TagControllerListResponses {
  200: {
    data: TagList;
  };
}

export type TagControllerListResponse = TagControllerListResponses[200];

export type TagControllerListResult = ApiResponse<200, TagControllerListResponses[200]>;

export const TagControllerListSchemas = {
  responses: {
    200: z.object({
      data: TagListSchema,
    }),
  },
} satisfies OperationSchemas;

export function getTagControllerListUrl(): string {
  return buildUrl('/tags');
}

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

export type TagControllerCreateBody = CreateTagRequest;

export interface TagControllerCreateInput {
  body: TagControllerCreateBody;
}

export interface TagControllerCreateResponses {
  201: {
    data: Tag;
  };
}

export type TagControllerCreateResponse = TagControllerCreateResponses[201];

export type TagControllerCreateResult = ApiResponse<201, TagControllerCreateResponses[201]>;

export const TagControllerCreateSchemas = {
  body: CreateTagRequestSchema,
  responses: {
    201: z.object({
      data: TagSchema,
    }),
  },
} satisfies OperationSchemas;

export function getTagControllerCreateUrl(): string {
  return buildUrl('/tags');
}

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

export interface TagControllerRemovePathParams {
  id: string;
}

export interface TagControllerRemoveInput {
  path: TagControllerRemovePathParams;
}

export interface TagControllerRemoveResponses {
  204: undefined;
}

export type TagControllerRemoveResponse = TagControllerRemoveResponses[204];

export type TagControllerRemoveResult = ApiResponse<204, TagControllerRemoveResponses[204]>;

export const TagControllerRemoveSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

export function getTagControllerRemoveUrl(path: TagControllerRemovePathParams): string {
  return buildUrl('/tags/{id}', path);
}

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

export interface TagControllerUpdatePathParams {
  id: string;
}

export type TagControllerUpdateBody = UpdateTagRequest;

export interface TagControllerUpdateInput {
  path: TagControllerUpdatePathParams;
  body: TagControllerUpdateBody;
}

export interface TagControllerUpdateResponses {
  200: {
    data: Tag;
  };
}

export type TagControllerUpdateResponse = TagControllerUpdateResponses[200];

export type TagControllerUpdateResult = ApiResponse<200, TagControllerUpdateResponses[200]>;

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

export function getTagControllerUpdateUrl(path: TagControllerUpdatePathParams): string {
  return buildUrl('/tags/{id}', path);
}

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

export interface TagControllerReplacePathParams {
  resourceType: string;
  resourceId: string;
}

export type TagControllerReplaceBody = ReplaceResourceTagsRequest;

export interface TagControllerReplaceInput {
  path: TagControllerReplacePathParams;
  body: TagControllerReplaceBody;
}

export interface TagControllerReplaceResponses {
  200: {
    data: ResourceTags;
  };
}

export type TagControllerReplaceResponse = TagControllerReplaceResponses[200];

export type TagControllerReplaceResult = ApiResponse<200, TagControllerReplaceResponses[200]>;

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

export function getTagControllerReplaceUrl(path: TagControllerReplacePathParams): string {
  return buildUrl('/tags/assignments/{resourceType}/{resourceId}', path);
}

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
