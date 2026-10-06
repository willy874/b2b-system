// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  PlatformAdminControllerAuditLogsResult,
  PlatformAdminControllerCreateInput,
  PlatformAdminControllerCreateResult,
  PlatformAdminControllerListResult,
  PlatformAdminControllerSendPasswordLinkInput,
  PlatformAdminControllerSendPasswordLinkResult,
  PlatformAdminControllerUpdateInput,
  PlatformAdminControllerUpdateResult,
} from '../../endpoints/platform-admins';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';
import {
  CreatePlatformAdminRequestSchema,
  PlatformAdminListSchema,
  PlatformAdminPasswordLinkSchema,
  PlatformAdminSchema,
  PlatformAuditLogSchema,
  UpdatePlatformAdminRequestSchema,
} from '../components';

// GET /platform/admins

export const PlatformAdminControllerListSchemas = {
  responses: {
    200: z.object({
      data: PlatformAdminListSchema,
    }),
  },
} satisfies OperationSchemas;

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

export const PlatformAdminControllerCreateSchemas = {
  body: CreatePlatformAdminRequestSchema,
  responses: {
    201: z.object({
      data: PlatformAdminSchema,
    }),
  },
} satisfies OperationSchemas;

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
