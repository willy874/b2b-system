// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type { PermissionCatalog } from '../models';
import type { ApiResponse } from '../runtime';
import { buildUrl } from '../url';

// GET /permissions

export interface PermissionControllerListResponses {
  200: {
    data: PermissionCatalog;
  };
}

export type PermissionControllerListResponse = PermissionControllerListResponses[200];

export type PermissionControllerListResult = ApiResponse<
  200,
  PermissionControllerListResponses[200]
>;

export function getPermissionControllerListUrl(): string {
  return buildUrl('/permissions');
}
