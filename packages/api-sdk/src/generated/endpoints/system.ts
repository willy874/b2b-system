// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { buildUrl, request } from '../runtime';
import type {
  ApiResponse,
  OperationDefinition,
  OperationSchemas,
  RequestOptions,
} from '../runtime';

// GET /system/info

export interface SystemControllerInfoResponses {
  200: undefined;
}

export type SystemControllerInfoResponse = SystemControllerInfoResponses[200];

export type SystemControllerInfoResult = ApiResponse<200, SystemControllerInfoResponses[200]>;

export const SystemControllerInfoSchemas = {} satisfies OperationSchemas;

export function getSystemControllerInfoUrl(): string {
  return buildUrl('/system/info');
}

const systemControllerInfoOperation: OperationDefinition = {
  id: 'SystemController_info',
  method: 'GET',
  path: '/system/info',
  responseTypes: { 200: 'none' },
  schemas: SystemControllerInfoSchemas,
};

/** 版本、建置時間、環境 */
export function systemControllerInfo(
  options?: RequestOptions,
): Promise<SystemControllerInfoResult> {
  return request<SystemControllerInfoResult>(systemControllerInfoOperation, {}, options);
}
