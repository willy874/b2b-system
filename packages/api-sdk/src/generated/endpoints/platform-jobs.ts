// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type { PlatformJob, PlatformJobQueueList, PlatformJobSummary } from '../models';
import { buildUrl, request } from '../runtime';
import type {
  ApiResponse,
  OperationDefinition,
  OperationSchemas,
  RequestOptions,
} from '../runtime';
import {
  PlatformJobQueueListSchema,
  PlatformJobSchema,
  PlatformJobSummarySchema,
} from '../schemas';

// GET /platform/jobs/queues

export interface PlatformJobControllerQueuesResponses {
  200: {
    data: PlatformJobQueueList;
  };
}

export type PlatformJobControllerQueuesResponse = PlatformJobControllerQueuesResponses[200];

export type PlatformJobControllerQueuesResult = ApiResponse<
  200,
  PlatformJobControllerQueuesResponses[200]
>;

export const PlatformJobControllerQueuesSchemas = {
  responses: {
    200: z.object({
      data: PlatformJobQueueListSchema,
    }),
  },
} satisfies OperationSchemas;

export function getPlatformJobControllerQueuesUrl(): string {
  return buildUrl('/platform/jobs/queues');
}

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

export interface PlatformJobControllerListResponses {
  200: {
    data: {
      items: Array<PlatformJobSummary>;
      pagination: {
        offset: number;
        limit: number;
        total: number;
      };
    };
  };
}

export type PlatformJobControllerListResponse = PlatformJobControllerListResponses[200];

export type PlatformJobControllerListResult = ApiResponse<
  200,
  PlatformJobControllerListResponses[200]
>;

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

export function getPlatformJobControllerListUrl(): string {
  return buildUrl('/platform/jobs');
}

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

export interface PlatformJobControllerFindOnePathParams {
  id: string;
}

export interface PlatformJobControllerFindOneInput {
  path: PlatformJobControllerFindOnePathParams;
}

export interface PlatformJobControllerFindOneResponses {
  200: {
    data: PlatformJob;
  };
}

export type PlatformJobControllerFindOneResponse = PlatformJobControllerFindOneResponses[200];

export type PlatformJobControllerFindOneResult = ApiResponse<
  200,
  PlatformJobControllerFindOneResponses[200]
>;

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

export function getPlatformJobControllerFindOneUrl(
  path: PlatformJobControllerFindOnePathParams,
): string {
  return buildUrl('/platform/jobs/{id}', path);
}

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

export interface PlatformJobControllerRetryPathParams {
  id: string;
}

export interface PlatformJobControllerRetryInput {
  path: PlatformJobControllerRetryPathParams;
}

export interface PlatformJobControllerRetryResponses {
  200: {
    data: PlatformJob;
  };
}

export type PlatformJobControllerRetryResponse = PlatformJobControllerRetryResponses[200];

export type PlatformJobControllerRetryResult = ApiResponse<
  200,
  PlatformJobControllerRetryResponses[200]
>;

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

export function getPlatformJobControllerRetryUrl(
  path: PlatformJobControllerRetryPathParams,
): string {
  return buildUrl('/platform/jobs/{id}/retry', path);
}

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
