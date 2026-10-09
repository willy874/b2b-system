// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  PlatformMfaMethodControllerClearSettingsInput,
  PlatformMfaMethodControllerClearSettingsResult,
  PlatformMfaMethodControllerGetSettingsInput,
  PlatformMfaMethodControllerGetSettingsResult,
  PlatformMfaMethodControllerImpactInput,
  PlatformMfaMethodControllerImpactResult,
  PlatformMfaMethodControllerListResult,
  PlatformMfaMethodControllerSaveSettingsInput,
  PlatformMfaMethodControllerSaveSettingsResult,
  PlatformMfaMethodControllerUpdateInput,
  PlatformMfaMethodControllerUpdateResult,
} from '../../endpoints/platform-mfa-methods';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';
import {
  MfaMethodImpactSchema,
  MfaMethodSettingsSchema,
  PlatformMfaMethodListSchema,
  PlatformMfaMethodSchema,
  UpdateMfaMethodSettingsRequestSchema,
  UpdatePlatformMfaMethodRequestSchema,
} from '../components';

// GET /platform/mfa-methods

export const PlatformMfaMethodControllerListSchemas = {
  responses: {
    200: z.object({
      data: PlatformMfaMethodListSchema,
    }),
  },
} satisfies OperationSchemas;

const platformMfaMethodControllerListOperation: OperationDefinition = {
  id: 'PlatformMfaMethodController_list',
  method: 'GET',
  path: '/platform/mfa-methods',
  responseTypes: { 200: 'json' },
  schemas: PlatformMfaMethodControllerListSchemas,
};

/** 驗證方式、全平台狀態、覆寫的租戶數、已設定的因子數 */
export function platformMfaMethodControllerList(
  options?: RequestOptions,
): Promise<PlatformMfaMethodControllerListResult> {
  return request<PlatformMfaMethodControllerListResult>(
    platformMfaMethodControllerListOperation,
    {},
    options,
  );
}

// GET /platform/mfa-methods/{id}/impact

export const PlatformMfaMethodControllerImpactSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: MfaMethodImpactSchema,
    }),
  },
} satisfies OperationSchemas;

const platformMfaMethodControllerImpactOperation: OperationDefinition = {
  id: 'PlatformMfaMethodController_impact',
  method: 'GET',
  path: '/platform/mfa-methods/{id}/impact',
  responseTypes: { 200: 'json' },
  schemas: PlatformMfaMethodControllerImpactSchemas,
};

/** 關掉這個方式會被擋在門外的人數（全平台或指定租戶） */
export function platformMfaMethodControllerImpact(
  input: PlatformMfaMethodControllerImpactInput,
  options?: RequestOptions,
): Promise<PlatformMfaMethodControllerImpactResult> {
  return request<PlatformMfaMethodControllerImpactResult>(
    platformMfaMethodControllerImpactOperation,
    input,
    options,
  );
}

// GET /platform/mfa-methods/{id}/settings

export const PlatformMfaMethodControllerGetSettingsSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: MfaMethodSettingsSchema,
    }),
  },
} satisfies OperationSchemas;

const platformMfaMethodControllerGetSettingsOperation: OperationDefinition = {
  id: 'PlatformMfaMethodController_getSettings',
  method: 'GET',
  path: '/platform/mfa-methods/{id}/settings',
  responseTypes: { 200: 'json' },
  schemas: PlatformMfaMethodControllerGetSettingsSchemas,
};

/** 方式的平台參數（機密欄位只回傳有沒有設定） */
export function platformMfaMethodControllerGetSettings(
  input: PlatformMfaMethodControllerGetSettingsInput,
  options?: RequestOptions,
): Promise<PlatformMfaMethodControllerGetSettingsResult> {
  return request<PlatformMfaMethodControllerGetSettingsResult>(
    platformMfaMethodControllerGetSettingsOperation,
    input,
    options,
  );
}

// PUT /platform/mfa-methods/{id}/settings

export const PlatformMfaMethodControllerSaveSettingsSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: UpdateMfaMethodSettingsRequestSchema,
  responses: {
    200: z.object({
      data: MfaMethodSettingsSchema,
    }),
  },
} satisfies OperationSchemas;

const platformMfaMethodControllerSaveSettingsOperation: OperationDefinition = {
  id: 'PlatformMfaMethodController_saveSettings',
  method: 'PUT',
  path: '/platform/mfa-methods/{id}/settings',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: PlatformMfaMethodControllerSaveSettingsSchemas,
};

/** 儲存方式的平台參數：必填、格式與方式自己的檢查（例：以金鑰呼叫供應商）全部通過才寫入 */
export function platformMfaMethodControllerSaveSettings(
  input: PlatformMfaMethodControllerSaveSettingsInput,
  options?: RequestOptions,
): Promise<PlatformMfaMethodControllerSaveSettingsResult> {
  return request<PlatformMfaMethodControllerSaveSettingsResult>(
    platformMfaMethodControllerSaveSettingsOperation,
    input,
    options,
  );
}

// DELETE /platform/mfa-methods/{id}/settings

export const PlatformMfaMethodControllerClearSettingsSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: MfaMethodSettingsSchema,
    }),
  },
} satisfies OperationSchemas;

const platformMfaMethodControllerClearSettingsOperation: OperationDefinition = {
  id: 'PlatformMfaMethodController_clearSettings',
  method: 'DELETE',
  path: '/platform/mfa-methods/{id}/settings',
  responseTypes: { 200: 'json' },
  schemas: PlatformMfaMethodControllerClearSettingsSchemas,
};

/** 刪除方式的平台參數（方式還開著時拒絕） */
export function platformMfaMethodControllerClearSettings(
  input: PlatformMfaMethodControllerClearSettingsInput,
  options?: RequestOptions,
): Promise<PlatformMfaMethodControllerClearSettingsResult> {
  return request<PlatformMfaMethodControllerClearSettingsResult>(
    platformMfaMethodControllerClearSettingsOperation,
    input,
    options,
  );
}

// PUT /platform/mfa-methods/{id}

export const PlatformMfaMethodControllerUpdateSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: UpdatePlatformMfaMethodRequestSchema,
  responses: {
    200: z.object({
      data: PlatformMfaMethodSchema,
    }),
  },
} satisfies OperationSchemas;

const platformMfaMethodControllerUpdateOperation: OperationDefinition = {
  id: 'PlatformMfaMethodController_update',
  method: 'PUT',
  path: '/platform/mfa-methods/{id}',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: PlatformMfaMethodControllerUpdateSchemas,
};

/** 全平台層的開關：on／off（緊急關閉，蓋過租戶層）／default */
export function platformMfaMethodControllerUpdate(
  input: PlatformMfaMethodControllerUpdateInput,
  options?: RequestOptions,
): Promise<PlatformMfaMethodControllerUpdateResult> {
  return request<PlatformMfaMethodControllerUpdateResult>(
    platformMfaMethodControllerUpdateOperation,
    input,
    options,
  );
}
