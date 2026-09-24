// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：Game Editor API 0.0.0（OpenAPI 3.0.0）

import { buildUrl, request } from '../runtime';
import type {
  ApiResponse,
  OperationDefinition,
  OperationSchemas,
  RequestOptions,
} from '../runtime';

// GET /health

export interface HealthControllerLiveResponses {
  200: undefined;
}

export type HealthControllerLiveResponse = HealthControllerLiveResponses[200];

export type HealthControllerLiveResult = ApiResponse<200, HealthControllerLiveResponses[200]>;

export const HealthControllerLiveSchemas = {} satisfies OperationSchemas;

export function getHealthControllerLiveUrl(): string {
  return buildUrl('/health');
}

const healthControllerLiveOperation: OperationDefinition = {
  id: 'HealthController_live',
  method: 'GET',
  path: '/health',
  responseTypes: { 200: 'none' },
  schemas: HealthControllerLiveSchemas,
};

/** Liveness probe */
export function healthControllerLive(
  options?: RequestOptions,
): Promise<HealthControllerLiveResult> {
  return request<HealthControllerLiveResult>(healthControllerLiveOperation, {}, options);
}

// GET /health/ready

export interface HealthControllerReadyResponses {
  200: undefined;
}

export type HealthControllerReadyResponse = HealthControllerReadyResponses[200];

export type HealthControllerReadyResult = ApiResponse<200, HealthControllerReadyResponses[200]>;

export const HealthControllerReadySchemas = {} satisfies OperationSchemas;

export function getHealthControllerReadyUrl(): string {
  return buildUrl('/health/ready');
}

const healthControllerReadyOperation: OperationDefinition = {
  id: 'HealthController_ready',
  method: 'GET',
  path: '/health/ready',
  responseTypes: { 200: 'none' },
  schemas: HealthControllerReadySchemas,
};

/** Readiness probe（含 DB ping） */
export function healthControllerReady(
  options?: RequestOptions,
): Promise<HealthControllerReadyResult> {
  return request<HealthControllerReadyResult>(healthControllerReadyOperation, {}, options);
}
