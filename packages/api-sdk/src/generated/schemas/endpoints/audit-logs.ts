// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  AuditLogControllerFindOneInput,
  AuditLogControllerFindOneResult,
  AuditLogControllerListResult,
} from '../../endpoints/audit-logs';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';
import { AuditLogSchema, AuditLogSummarySchema } from '../components';

// GET /audit-logs

export const AuditLogControllerListSchemas = {
  responses: {
    200: z.object({
      data: z.object({
        items: z.array(AuditLogSummarySchema),
        pagination: z.object({
          offset: z.int(),
          limit: z.int(),
          total: z.int(),
        }),
      }),
    }),
  },
} satisfies OperationSchemas;

const auditLogControllerListOperation: OperationDefinition = {
  id: 'AuditLogController_list',
  method: 'GET',
  path: '/audit-logs',
  responseTypes: { 200: 'json' },
  schemas: AuditLogControllerListSchemas,
};

/** 稽核日誌列表（固定 occurred_at DESC；時間範圍預設且最多 90 天；不含 changes / metadata） */
export function auditLogControllerList(
  options?: RequestOptions,
): Promise<AuditLogControllerListResult> {
  return request<AuditLogControllerListResult>(auditLogControllerListOperation, {}, options);
}

// GET /audit-logs/{id}

export const AuditLogControllerFindOneSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: AuditLogSchema,
    }),
  },
} satisfies OperationSchemas;

const auditLogControllerFindOneOperation: OperationDefinition = {
  id: 'AuditLogController_findOne',
  method: 'GET',
  path: '/audit-logs/{id}',
  responseTypes: { 200: 'json' },
  schemas: AuditLogControllerFindOneSchemas,
};

/** 稽核日誌單筆詳情 */
export function auditLogControllerFindOne(
  input: AuditLogControllerFindOneInput,
  options?: RequestOptions,
): Promise<AuditLogControllerFindOneResult> {
  return request<AuditLogControllerFindOneResult>(
    auditLogControllerFindOneOperation,
    input,
    options,
  );
}
