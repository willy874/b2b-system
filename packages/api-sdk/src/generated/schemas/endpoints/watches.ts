// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  WatchControllerStateInput,
  WatchControllerStateResult,
  WatchControllerUnwatchInput,
  WatchControllerUnwatchResult,
  WatchControllerWatchInput,
  WatchControllerWatchResult,
} from '../../endpoints/watches';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';
import { WatchStateSchema } from '../components';

// GET /watches/{resourceType}/{resourceId}

export const WatchControllerStateSchemas = {
  path: z.object({
    resourceType: z.string(),
    resourceId: z.string(),
  }),
  responses: {
    200: z.object({
      data: WatchStateSchema,
    }),
  },
} satisfies OperationSchemas;

const watchControllerStateOperation: OperationDefinition = {
  id: 'WatchController_state',
  method: 'GET',
  path: '/watches/{resourceType}/{resourceId}',
  responseTypes: { 200: 'json' },
  schemas: WatchControllerStateSchemas,
};

/** 自己有沒有關注、關注的人數 */
export function watchControllerState(
  input: WatchControllerStateInput,
  options?: RequestOptions,
): Promise<WatchControllerStateResult> {
  return request<WatchControllerStateResult>(watchControllerStateOperation, input, options);
}

// PUT /watches/{resourceType}/{resourceId}

export const WatchControllerWatchSchemas = {
  path: z.object({
    resourceType: z.string(),
    resourceId: z.string(),
  }),
  responses: {
    200: z.object({
      data: WatchStateSchema,
    }),
  },
} satisfies OperationSchemas;

const watchControllerWatchOperation: OperationDefinition = {
  id: 'WatchController_watch',
  method: 'PUT',
  path: '/watches/{resourceType}/{resourceId}',
  responseTypes: { 200: 'json' },
  schemas: WatchControllerWatchSchemas,
};

/** 關注；有新留言或資源被修改時收到通知 */
export function watchControllerWatch(
  input: WatchControllerWatchInput,
  options?: RequestOptions,
): Promise<WatchControllerWatchResult> {
  return request<WatchControllerWatchResult>(watchControllerWatchOperation, input, options);
}

// DELETE /watches/{resourceType}/{resourceId}

export const WatchControllerUnwatchSchemas = {
  path: z.object({
    resourceType: z.string(),
    resourceId: z.string(),
  }),
  responses: {
    200: z.object({
      data: WatchStateSchema,
    }),
  },
} satisfies OperationSchemas;

const watchControllerUnwatchOperation: OperationDefinition = {
  id: 'WatchController_unwatch',
  method: 'DELETE',
  path: '/watches/{resourceType}/{resourceId}',
  responseTypes: { 200: 'json' },
  schemas: WatchControllerUnwatchSchemas,
};

/** 取消關注 */
export function watchControllerUnwatch(
  input: WatchControllerUnwatchInput,
  options?: RequestOptions,
): Promise<WatchControllerUnwatchResult> {
  return request<WatchControllerUnwatchResult>(watchControllerUnwatchOperation, input, options);
}
