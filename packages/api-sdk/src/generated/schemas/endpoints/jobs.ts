// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  JobControllerFindOneInput,
  JobControllerFindOneResult,
  JobControllerListResult,
  JobControllerQueuesResult,
  JobControllerRetryInput,
  JobControllerRetryResult,
} from '../../endpoints/jobs';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';
import { JobQueueListSchema, JobSchema, JobSummarySchema } from '../components';

// GET /jobs/queues

export const JobControllerQueuesSchemas = {
  responses: {
    200: z.object({
      data: JobQueueListSchema,
    }),
  },
} satisfies OperationSchemas;

const jobControllerQueuesOperation: OperationDefinition = {
  id: 'JobController_queues',
  method: 'GET',
  path: '/jobs/queues',
  responseTypes: { 200: 'json' },
  schemas: JobControllerQueuesSchemas,
};

/** 各種背景工作的佇列狀態（等待、執行中、失敗筆數與排程） */
export function jobControllerQueues(options?: RequestOptions): Promise<JobControllerQueuesResult> {
  return request<JobControllerQueuesResult>(jobControllerQueuesOperation, {}, options);
}

// GET /jobs

export const JobControllerListSchemas = {
  responses: {
    200: z.object({
      data: z.object({
        items: z.array(JobSummarySchema),
        pagination: z.object({
          offset: z.int(),
          limit: z.int(),
          total: z.int(),
        }),
      }),
    }),
  },
} satisfies OperationSchemas;

const jobControllerListOperation: OperationDefinition = {
  id: 'JobController_list',
  method: 'GET',
  path: '/jobs',
  responseTypes: { 200: 'json' },
  schemas: JobControllerListSchemas,
};

/** 背景工作列表（固定 createdOn DESC；不含 data / output） */
export function jobControllerList(options?: RequestOptions): Promise<JobControllerListResult> {
  return request<JobControllerListResult>(jobControllerListOperation, {}, options);
}

// GET /jobs/{id}

export const JobControllerFindOneSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: JobSchema,
    }),
  },
} satisfies OperationSchemas;

const jobControllerFindOneOperation: OperationDefinition = {
  id: 'JobController_findOne',
  method: 'GET',
  path: '/jobs/{id}',
  responseTypes: { 200: 'json' },
  schemas: JobControllerFindOneSchemas,
};

/** 背景工作詳情（含 data 與 output） */
export function jobControllerFindOne(
  input: JobControllerFindOneInput,
  options?: RequestOptions,
): Promise<JobControllerFindOneResult> {
  return request<JobControllerFindOneResult>(jobControllerFindOneOperation, input, options);
}

// POST /jobs/{id}/retry

export const JobControllerRetrySchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: JobSchema,
    }),
  },
} satisfies OperationSchemas;

const jobControllerRetryOperation: OperationDefinition = {
  id: 'JobController_retry',
  method: 'POST',
  path: '/jobs/{id}/retry',
  responseTypes: { 200: 'json' },
  schemas: JobControllerRetrySchemas,
};

/** 重新排入失敗的工作（只接受 failed） */
export function jobControllerRetry(
  input: JobControllerRetryInput,
  options?: RequestOptions,
): Promise<JobControllerRetryResult> {
  return request<JobControllerRetryResult>(jobControllerRetryOperation, input, options);
}
