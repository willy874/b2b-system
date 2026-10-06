// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type {
  CreatePlatformAdminRequest,
  PlatformAdmin,
  PlatformAdminList,
  PlatformAdminPasswordLink,
  PlatformAuditLog,
  UpdatePlatformAdminRequest,
} from '../models';
import type { ApiResponse } from '../runtime';
import { buildUrl } from '../url';

// GET /platform/admins

export interface PlatformAdminControllerListResponses {
  200: {
    data: PlatformAdminList;
  };
}

export type PlatformAdminControllerListResponse = PlatformAdminControllerListResponses[200];

export type PlatformAdminControllerListResult = ApiResponse<
  200,
  PlatformAdminControllerListResponses[200]
>;

export function getPlatformAdminControllerListUrl(): string {
  return buildUrl('/platform/admins');
}

// POST /platform/admins

export type PlatformAdminControllerCreateBody = CreatePlatformAdminRequest;

export interface PlatformAdminControllerCreateInput {
  body: PlatformAdminControllerCreateBody;
}

export interface PlatformAdminControllerCreateResponses {
  201: {
    data: PlatformAdmin;
  };
}

export type PlatformAdminControllerCreateResponse = PlatformAdminControllerCreateResponses[201];

export type PlatformAdminControllerCreateResult = ApiResponse<
  201,
  PlatformAdminControllerCreateResponses[201]
>;

export function getPlatformAdminControllerCreateUrl(): string {
  return buildUrl('/platform/admins');
}

// PATCH /platform/admins/{id}

export interface PlatformAdminControllerUpdatePathParams {
  id: string;
}

export type PlatformAdminControllerUpdateBody = UpdatePlatformAdminRequest;

export interface PlatformAdminControllerUpdateInput {
  path: PlatformAdminControllerUpdatePathParams;
  body: PlatformAdminControllerUpdateBody;
}

export interface PlatformAdminControllerUpdateResponses {
  200: {
    data: PlatformAdmin;
  };
}

export type PlatformAdminControllerUpdateResponse = PlatformAdminControllerUpdateResponses[200];

export type PlatformAdminControllerUpdateResult = ApiResponse<
  200,
  PlatformAdminControllerUpdateResponses[200]
>;

export function getPlatformAdminControllerUpdateUrl(
  path: PlatformAdminControllerUpdatePathParams,
): string {
  return buildUrl('/platform/admins/{id}', path);
}

// POST /platform/admins/{id}/password-link

export interface PlatformAdminControllerSendPasswordLinkPathParams {
  id: string;
}

export interface PlatformAdminControllerSendPasswordLinkInput {
  path: PlatformAdminControllerSendPasswordLinkPathParams;
}

export interface PlatformAdminControllerSendPasswordLinkResponses {
  200: {
    data: PlatformAdminPasswordLink;
  };
}

export type PlatformAdminControllerSendPasswordLinkResponse =
  PlatformAdminControllerSendPasswordLinkResponses[200];

export type PlatformAdminControllerSendPasswordLinkResult = ApiResponse<
  200,
  PlatformAdminControllerSendPasswordLinkResponses[200]
>;

export function getPlatformAdminControllerSendPasswordLinkUrl(
  path: PlatformAdminControllerSendPasswordLinkPathParams,
): string {
  return buildUrl('/platform/admins/{id}/password-link', path);
}

// GET /platform/audit-logs

export interface PlatformAdminControllerAuditLogsResponses {
  200: {
    data: {
      items: Array<PlatformAuditLog>;
      pagination: {
        offset: number;
        limit: number;
        total: number;
      };
    };
  };
}

export type PlatformAdminControllerAuditLogsResponse =
  PlatformAdminControllerAuditLogsResponses[200];

export type PlatformAdminControllerAuditLogsResult = ApiResponse<
  200,
  PlatformAdminControllerAuditLogsResponses[200]
>;

export function getPlatformAdminControllerAuditLogsUrl(): string {
  return buildUrl('/platform/audit-logs');
}
