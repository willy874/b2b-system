// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type {
  HealthControllerLiveResult,
  HealthControllerReadyResult,
} from '../../endpoints/health';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';

// GET /health

export const HealthControllerLiveSchemas = {} satisfies OperationSchemas;

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

export const HealthControllerReadySchemas = {} satisfies OperationSchemas;

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
