// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  CommentControllerCreateInput,
  CommentControllerCreateResult,
  CommentControllerListInput,
  CommentControllerListResult,
  CommentControllerMentionableInput,
  CommentControllerMentionableResult,
  CommentControllerRemoveInput,
  CommentControllerRemoveResult,
  CommentControllerUpdateInput,
  CommentControllerUpdateResult,
} from '../../endpoints/comments';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';
import {
  CommentPageSchema,
  CommentSchema,
  CreateCommentRequestSchema,
  MentionableListSchema,
  UpdateCommentRequestSchema,
} from '../components';

// GET /comments/{resourceType}/{resourceId}

export const CommentControllerListSchemas = {
  path: z.object({
    resourceType: z.string(),
    resourceId: z.string(),
  }),
  responses: {
    200: z.object({
      data: CommentPageSchema,
    }),
  },
} satisfies OperationSchemas;

const commentControllerListOperation: OperationDefinition = {
  id: 'CommentController_list',
  method: 'GET',
  path: '/comments/{resourceType}/{resourceId}',
  responseTypes: { 200: 'json' },
  schemas: CommentControllerListSchemas,
};

/** 一個資源的留言，新的在前；看得到那個資源才能讀 */
export function commentControllerList(
  input: CommentControllerListInput,
  options?: RequestOptions,
): Promise<CommentControllerListResult> {
  return request<CommentControllerListResult>(commentControllerListOperation, input, options);
}

// POST /comments/{resourceType}/{resourceId}

export const CommentControllerCreateSchemas = {
  path: z.object({
    resourceType: z.string(),
    resourceId: z.string(),
  }),
  body: CreateCommentRequestSchema,
  responses: {
    201: z.object({
      data: CommentSchema,
    }),
  },
} satisfies OperationSchemas;

const commentControllerCreateOperation: OperationDefinition = {
  id: 'CommentController_create',
  method: 'POST',
  path: '/comments/{resourceType}/{resourceId}',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 201: 'json' },
  schemas: CommentControllerCreateSchemas,
};

/** 留言；作者自動關注這個資源，被提及的人與關注者收到通知 */
export function commentControllerCreate(
  input: CommentControllerCreateInput,
  options?: RequestOptions,
): Promise<CommentControllerCreateResult> {
  return request<CommentControllerCreateResult>(commentControllerCreateOperation, input, options);
}

// GET /comments/{resourceType}/{resourceId}/mentionable

export const CommentControllerMentionableSchemas = {
  path: z.object({
    resourceType: z.string(),
    resourceId: z.string(),
  }),
  responses: {
    200: z.object({
      data: MentionableListSchema,
    }),
  },
} satisfies OperationSchemas;

const commentControllerMentionableOperation: OperationDefinition = {
  id: 'CommentController_mentionable',
  method: 'GET',
  path: '/comments/{resourceType}/{resourceId}/mentionable',
  responseTypes: { 200: 'json' },
  schemas: CommentControllerMentionableSchemas,
};

/** @提及的候選：看得到這個資源的人（最多 10 位） */
export function commentControllerMentionable(
  input: CommentControllerMentionableInput,
  options?: RequestOptions,
): Promise<CommentControllerMentionableResult> {
  return request<CommentControllerMentionableResult>(
    commentControllerMentionableOperation,
    input,
    options,
  );
}

// DELETE /comments/{id}

export const CommentControllerRemoveSchemas = {
  path: z.object({
    id: z.string(),
  }),
} satisfies OperationSchemas;

const commentControllerRemoveOperation: OperationDefinition = {
  id: 'CommentController_remove',
  method: 'DELETE',
  path: '/comments/{id}',
  responseTypes: { 204: 'none' },
  schemas: CommentControllerRemoveSchemas,
};

/** 刪除留言：作者本人，或持有 comment:delete；不進回收桶 */
export function commentControllerRemove(
  input: CommentControllerRemoveInput,
  options?: RequestOptions,
): Promise<CommentControllerRemoveResult> {
  return request<CommentControllerRemoveResult>(commentControllerRemoveOperation, input, options);
}

// PATCH /comments/{id}

export const CommentControllerUpdateSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: UpdateCommentRequestSchema,
  responses: {
    200: z.object({
      data: CommentSchema,
    }),
  },
} satisfies OperationSchemas;

const commentControllerUpdateOperation: OperationDefinition = {
  id: 'CommentController_update',
  method: 'PATCH',
  path: '/comments/{id}',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: CommentControllerUpdateSchemas,
};

/** 編輯自己的留言（帶 version） */
export function commentControllerUpdate(
  input: CommentControllerUpdateInput,
  options?: RequestOptions,
): Promise<CommentControllerUpdateResult> {
  return request<CommentControllerUpdateResult>(commentControllerUpdateOperation, input, options);
}
