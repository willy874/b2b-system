// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  CreatePlatformAdminRequest,
  PlatformAdmin,
  PlatformAdminList,
  PlatformAdminPasswordLink,
  PlatformAuditLog,
  UpdatePlatformAdminRequest,
} from '../models';
import { buildUrl, request } from '../runtime';
import type {
  ApiResponse,
  OperationDefinition,
  OperationSchemas,
  RequestOptions,
} from '../runtime';
import {
  CreatePlatformAdminRequestSchema,
  PlatformAdminListSchema,
  PlatformAdminPasswordLinkSchema,
  PlatformAdminSchema,
  PlatformAuditLogSchema,
  UpdatePlatformAdminRequestSchema,
} from '../schemas';

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

export const PlatformAdminControllerListSchemas = {
  responses: {
    200: z.object({
      data: PlatformAdminListSchema,
    }),
  },
} satisfies OperationSchemas;

export function getPlatformAdminControllerListUrl(): string {
  return buildUrl('/platform/admins');
}

const platformAdminControllerListOperation: OperationDefinition = {
  id: 'PlatformAdminController_list',
  method: 'GET',
  path: '/platform/admins',
  responseTypes: { 200: 'json' },
  schemas: PlatformAdminControllerListSchemas,
};

export function platformAdminControllerList(
  options?: RequestOptions,
): Promise<PlatformAdminControllerListResult> {
  return request<PlatformAdminControllerListResult>(
    platformAdminControllerListOperation,
    {},
    options,
  );
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

export const PlatformAdminControllerCreateSchemas = {
  body: CreatePlatformAdminRequestSchema,
  responses: {
    201: z.object({
      data: PlatformAdminSchema,
    }),
  },
} satisfies OperationSchemas;

export function getPlatformAdminControllerCreateUrl(): string {
  return buildUrl('/platform/admins');
}

const platformAdminControllerCreateOperation: OperationDefinition = {
  id: 'PlatformAdminController_create',
  method: 'POST',
  path: '/platform/admins',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 201: 'json' },
  schemas: PlatformAdminControllerCreateSchemas,
};

/** 新增平台管理者：建立成 pending，寄啟用信讓本人設定密碼 */
export function platformAdminControllerCreate(
  input: PlatformAdminControllerCreateInput,
  options?: RequestOptions,
): Promise<PlatformAdminControllerCreateResult> {
  return request<PlatformAdminControllerCreateResult>(
    platformAdminControllerCreateOperation,
    input,
    options,
  );
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

export const PlatformAdminControllerUpdateSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: UpdatePlatformAdminRequestSchema,
  responses: {
    200: z.object({
      data: PlatformAdminSchema,
    }),
  },
} satisfies OperationSchemas;

export function getPlatformAdminControllerUpdateUrl(
  path: PlatformAdminControllerUpdatePathParams,
): string {
  return buildUrl('/platform/admins/{id}', path);
}

const platformAdminControllerUpdateOperation: OperationDefinition = {
  id: 'PlatformAdminController_update',
  method: 'PATCH',
  path: '/platform/admins/{id}',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: PlatformAdminControllerUpdateSchemas,
};

/** 改名、換角色、停用／啟用（停用即撤銷 session；locked 改回 active 即解鎖） */
export function platformAdminControllerUpdate(
  input: PlatformAdminControllerUpdateInput,
  options?: RequestOptions,
): Promise<PlatformAdminControllerUpdateResult> {
  return request<PlatformAdminControllerUpdateResult>(
    platformAdminControllerUpdateOperation,
    input,
    options,
  );
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

export const PlatformAdminControllerSendPasswordLinkSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: PlatformAdminPasswordLinkSchema,
    }),
  },
} satisfies OperationSchemas;

export function getPlatformAdminControllerSendPasswordLinkUrl(
  path: PlatformAdminControllerSendPasswordLinkPathParams,
): string {
  return buildUrl('/platform/admins/{id}/password-link', path);
}

const platformAdminControllerSendPasswordLinkOperation: OperationDefinition = {
  id: 'PlatformAdminController_sendPasswordLink',
  method: 'POST',
  path: '/platform/admins/{id}/password-link',
  responseTypes: { 200: 'json' },
  schemas: PlatformAdminControllerSendPasswordLinkSchemas,
};

/** 寄設定密碼的連結：還沒啟用的寄啟用信，其他人寄重設密碼信 */
export function platformAdminControllerSendPasswordLink(
  input: PlatformAdminControllerSendPasswordLinkInput,
  options?: RequestOptions,
): Promise<PlatformAdminControllerSendPasswordLinkResult> {
  return request<PlatformAdminControllerSendPasswordLinkResult>(
    platformAdminControllerSendPasswordLinkOperation,
    input,
    options,
  );
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

export const PlatformAdminControllerAuditLogsSchemas = {
  responses: {
    200: z.object({
      data: z.object({
        items: z.array(PlatformAuditLogSchema),
        pagination: z.object({
          offset: z.int(),
          limit: z.int(),
          total: z.int(),
        }),
      }),
    }),
  },
} satisfies OperationSchemas;

export function getPlatformAdminControllerAuditLogsUrl(): string {
  return buildUrl('/platform/audit-logs');
}

const platformAdminControllerAuditLogsOperation: OperationDefinition = {
  id: 'PlatformAdminController_auditLogs',
  method: 'GET',
  path: '/platform/audit-logs',
  responseTypes: { 200: 'json' },
  schemas: PlatformAdminControllerAuditLogsSchemas,
};

/** 平台稽核（固定 occurred_at DESC；時間範圍預設且最多 90 天） */
export function platformAdminControllerAuditLogs(
  options?: RequestOptions,
): Promise<PlatformAdminControllerAuditLogsResult> {
  return request<PlatformAdminControllerAuditLogsResult>(
    platformAdminControllerAuditLogsOperation,
    {},
    options,
  );
}
