// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type { ApiResponse } from '../runtime';
import { buildUrl } from '../url';

// GET /health

export interface HealthControllerLiveResponses {
  200: undefined;
}

export type HealthControllerLiveResponse = HealthControllerLiveResponses[200];

export type HealthControllerLiveResult = ApiResponse<200, HealthControllerLiveResponses[200]>;

export function getHealthControllerLiveUrl(): string {
  return buildUrl('/health');
}

// GET /health/ready

export interface HealthControllerReadyResponses {
  200: undefined;
}

export type HealthControllerReadyResponse = HealthControllerReadyResponses[200];

export type HealthControllerReadyResult = ApiResponse<200, HealthControllerReadyResponses[200]>;

export function getHealthControllerReadyUrl(): string {
  return buildUrl('/health/ready');
}
