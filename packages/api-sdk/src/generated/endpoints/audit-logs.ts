// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type { AuditLog, AuditLogList } from '../models';
import type { ApiResponse } from '../runtime';
import { buildUrl } from '../url';

// GET /audit-logs

export interface AuditLogControllerListResponses {
  200: {
    data: AuditLogList;
  };
}

export type AuditLogControllerListResponse = AuditLogControllerListResponses[200];

export type AuditLogControllerListResult = ApiResponse<200, AuditLogControllerListResponses[200]>;

export function getAuditLogControllerListUrl(): string {
  return buildUrl('/audit-logs');
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

export function getAuditLogControllerFindOneUrl(path: AuditLogControllerFindOnePathParams): string {
  return buildUrl('/audit-logs/{id}', path);
}
