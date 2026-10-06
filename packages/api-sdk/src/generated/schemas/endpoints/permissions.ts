// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type { PermissionControllerListResult } from '../../endpoints/permissions';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';
import { PermissionCatalogSchema } from '../components';

// GET /permissions

export const PermissionControllerListSchemas = {
  responses: {
    200: z.object({
      data: PermissionCatalogSchema,
    }),
  },
} satisfies OperationSchemas;

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
