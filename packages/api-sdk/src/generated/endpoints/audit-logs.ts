// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：Game Editor API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type { AuditLog, AuditLogSummary } from '../models';
import { buildUrl, request } from '../runtime';
import type {
  ApiResponse,
  OperationDefinition,
  OperationSchemas,
  RequestOptions,
} from '../runtime';
import { AuditLogSchema, AuditLogSummarySchema } from '../schemas';

// GET /audit-logs

export interface AuditLogControllerListResponses {
  200: {
    data: {
      items: Array<AuditLogSummary>;
      pagination: {
        offset: number;
        limit: number;
        total: number;
      };
    };
  };
}

export type AuditLogControllerListResponse = AuditLogControllerListResponses[200];

export type AuditLogControllerListResult = ApiResponse<200, AuditLogControllerListResponses[200]>;

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

export function getAuditLogControllerListUrl(): string {
  return buildUrl('/audit-logs');
}

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

export interface AuditLogControllerFindOnePathParams {
  id: string;
}

export interface AuditLogControllerFindOneInput {
  path: AuditLogControllerFindOnePathParams;
}

export interface AuditLogControllerFindOneResponses {
  200: {
    data: AuditLog;
  };
}

export type AuditLogControllerFindOneResponse = AuditLogControllerFindOneResponses[200];

export type AuditLogControllerFindOneResult = ApiResponse<
  200,
  AuditLogControllerFindOneResponses[200]
>;

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

export function getAuditLogControllerFindOneUrl(path: AuditLogControllerFindOnePathParams): string {
  return buildUrl('/audit-logs/{id}', path);
}

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
