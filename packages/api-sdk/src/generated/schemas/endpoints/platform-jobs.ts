// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  PlatformJobControllerFindOneInput,
  PlatformJobControllerFindOneResult,
  PlatformJobControllerListResult,
  PlatformJobControllerQueuesResult,
  PlatformJobControllerRetryInput,
  PlatformJobControllerRetryResult,
} from '../../endpoints/platform-jobs';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';
import {
  PlatformJobQueueListSchema,
  PlatformJobSchema,
  PlatformJobSummarySchema,
} from '../components';

// GET /platform/jobs/queues

export const PlatformJobControllerQueuesSchemas = {
  responses: {
    200: z.object({
      data: PlatformJobQueueListSchema,
    }),
  },
} satisfies OperationSchemas;

const platformJobControllerQueuesOperation: OperationDefinition = {
  id: 'PlatformJobController_queues',
  method: 'GET',
  path: '/platform/jobs/queues',
  responseTypes: { 200: 'json' },
  schemas: PlatformJobControllerQueuesSchemas,
};

/** 每種工作的佇列狀態（所有租戶合計） */
export function platformJobControllerQueues(
  options?: RequestOptions,
): Promise<PlatformJobControllerQueuesResult> {
  return request<PlatformJobControllerQueuesResult>(
    platformJobControllerQueuesOperation,
    {},
    options,
  );
}

// GET /platform/jobs

export const PlatformJobControllerListSchemas = {
  responses: {
    200: z.object({
      data: z.object({
        items: z.array(PlatformJobSummarySchema),
        pagination: z.object({
          offset: z.int(),
          limit: z.int(),
          total: z.int(),
        }),
      }),
    }),
  },
} satisfies OperationSchemas;

const platformJobControllerListOperation: OperationDefinition = {
  id: 'PlatformJobController_list',
  method: 'GET',
  path: '/platform/jobs',
  responseTypes: { 200: 'json' },
  schemas: PlatformJobControllerListSchemas,
};

/** 背景工作列表（固定 createdOn DESC；tenant=代碼或 platform） */
export function platformJobControllerList(
  options?: RequestOptions,
): Promise<PlatformJobControllerListResult> {
  return request<PlatformJobControllerListResult>(platformJobControllerListOperation, {}, options);
}

// GET /platform/jobs/{id}

export const PlatformJobControllerFindOneSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: PlatformJobSchema,
    }),
  },
} satisfies OperationSchemas;

const platformJobControllerFindOneOperation: OperationDefinition = {
  id: 'PlatformJobController_findOne',
  method: 'GET',
  path: '/platform/jobs/{id}',
  responseTypes: { 200: 'json' },
  schemas: PlatformJobControllerFindOneSchemas,
};

export function platformJobControllerFindOne(
  input: PlatformJobControllerFindOneInput,
  options?: RequestOptions,
): Promise<PlatformJobControllerFindOneResult> {
  return request<PlatformJobControllerFindOneResult>(
    platformJobControllerFindOneOperation,
    input,
    options,
  );
}

// POST /platform/jobs/{id}/retry

export const PlatformJobControllerRetrySchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: PlatformJobSchema,
    }),
  },
} satisfies OperationSchemas;

const platformJobControllerRetryOperation: OperationDefinition = {
  id: 'PlatformJobController_retry',
  method: 'POST',
  path: '/platform/jobs/{id}/retry',
  responseTypes: { 200: 'json' },
  schemas: PlatformJobControllerRetrySchemas,
};

export function platformJobControllerRetry(
  input: PlatformJobControllerRetryInput,
  options?: RequestOptions,
): Promise<PlatformJobControllerRetryResult> {
  return request<PlatformJobControllerRetryResult>(
    platformJobControllerRetryOperation,
    input,
    options,
  );
}
