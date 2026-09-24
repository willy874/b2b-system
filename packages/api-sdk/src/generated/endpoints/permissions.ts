// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：Game Editor API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type { PermissionCatalog } from '../models';
import { buildUrl, request } from '../runtime';
import type {
  ApiResponse,
  OperationDefinition,
  OperationSchemas,
  RequestOptions,
} from '../runtime';
import { PermissionCatalogSchema } from '../schemas';

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

export const PermissionControllerListSchemas = {
  responses: {
    200: z.object({
      data: PermissionCatalogSchema,
    }),
  },
} satisfies OperationSchemas;

export function getPermissionControllerListUrl(): string {
  return buildUrl('/permissions');
}

const permissionControllerListOperation: OperationDefinition = {
  id: 'PermissionController_list',
  method: 'GET',
  path: '/permissions',
  responseTypes: { 200: 'json' },
  schemas: PermissionControllerListSchemas,
};

/** 權限目錄（唯讀，不分頁） */
export function permissionControllerList(
  options?: RequestOptions,
): Promise<PermissionControllerListResult> {
  return request<PermissionControllerListResult>(permissionControllerListOperation, {}, options);
}
