// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type { PlatformJob, PlatformJobQueueList, PlatformJobSummary } from '../models';
import type { ApiResponse } from '../runtime';
import { buildUrl } from '../url';

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

export function getPlatformJobControllerQueuesUrl(): string {
  return buildUrl('/platform/jobs/queues');
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

export function getPlatformJobControllerListUrl(): string {
  return buildUrl('/platform/jobs');
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

export function getPlatformJobControllerFindOneUrl(
  path: PlatformJobControllerFindOnePathParams,
): string {
  return buildUrl('/platform/jobs/{id}', path);
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

export function getPlatformJobControllerRetryUrl(
  path: PlatformJobControllerRetryPathParams,
): string {
  return buildUrl('/platform/jobs/{id}/retry', path);
}
