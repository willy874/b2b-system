// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type { Job, JobQueueList, JobSummary } from '../models';
import type { ApiResponse } from '../runtime';
import { buildUrl } from '../url';

// GET /jobs/queues

export interface JobControllerQueuesResponses {
  200: {
    data: JobQueueList;
  };
}

export type JobControllerQueuesResponse = JobControllerQueuesResponses[200];

export type JobControllerQueuesResult = ApiResponse<200, JobControllerQueuesResponses[200]>;

export function getJobControllerQueuesUrl(): string {
  return buildUrl('/jobs/queues');
}

// GET /jobs

export interface JobControllerListResponses {
  200: {
    data: {
      items: Array<JobSummary>;
      pagination: {
        offset: number;
        limit: number;
        total: number;
      };
    };
  };
}

export type JobControllerListResponse = JobControllerListResponses[200];

export type JobControllerListResult = ApiResponse<200, JobControllerListResponses[200]>;

export function getJobControllerListUrl(): string {
  return buildUrl('/jobs');
}

// GET /jobs/{id}

export interface JobControllerFindOnePathParams {
  id: string;
}

export interface JobControllerFindOneInput {
  path: JobControllerFindOnePathParams;
}

export interface JobControllerFindOneResponses {
  200: {
    data: Job;
  };
}

export type JobControllerFindOneResponse = JobControllerFindOneResponses[200];

export type JobControllerFindOneResult = ApiResponse<200, JobControllerFindOneResponses[200]>;

export function getJobControllerFindOneUrl(path: JobControllerFindOnePathParams): string {
  return buildUrl('/jobs/{id}', path);
}

// POST /jobs/{id}/retry

export interface JobControllerRetryPathParams {
  id: string;
}

export interface JobControllerRetryInput {
  path: JobControllerRetryPathParams;
}

export interface JobControllerRetryResponses {
  200: {
    data: Job;
  };
}

export type JobControllerRetryResponse = JobControllerRetryResponses[200];

export type JobControllerRetryResult = ApiResponse<200, JobControllerRetryResponses[200]>;

export function getJobControllerRetryUrl(path: JobControllerRetryPathParams): string {
  return buildUrl('/jobs/{id}/retry', path);
}
