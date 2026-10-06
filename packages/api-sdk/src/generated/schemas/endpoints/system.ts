// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  SystemControllerInfoResult,
  SystemSettingControllerListPublicResult,
  SystemSettingControllerListResult,
  SystemSettingControllerUpdateInput,
  SystemSettingControllerUpdateResult,
} from '../../endpoints/system';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';
import {
  PublicSystemSettingsSchema,
  SystemSettingListSchema,
  UpdateSystemSettingsRequestSchema,
} from '../components';

// GET /system/info

export const SystemControllerInfoSchemas = {} satisfies OperationSchemas;

const systemControllerInfoOperation: OperationDefinition = {
  id: 'SystemController_info',
  method: 'GET',
  path: '/system/info',
  responseTypes: { 200: 'none' },
  schemas: SystemControllerInfoSchemas,
};

/** 版本、建置時間、環境 */
export function systemControllerInfo(
  options?: RequestOptions,
): Promise<SystemControllerInfoResult> {
  return request<SystemControllerInfoResult>(systemControllerInfoOperation, {}, options);
}

// GET /system/settings

export const SystemSettingControllerListSchemas = {
  responses: {
    200: z.object({
      data: SystemSettingListSchema,
    }),
  },
} satisfies OperationSchemas;

const systemSettingControllerListOperation: OperationDefinition = {
  id: 'SystemSettingController_list',
  method: 'GET',
  path: '/system/settings',
  responseTypes: { 200: 'json' },
  schemas: SystemSettingControllerListSchemas,
};

/** 所有設定：生效值、預設值、是否覆寫、允許範圍 */
export function systemSettingControllerList(
  options?: RequestOptions,
): Promise<SystemSettingControllerListResult> {
  return request<SystemSettingControllerListResult>(
    systemSettingControllerListOperation,
    {},
    options,
  );
}

// PATCH /system/settings

export const SystemSettingControllerUpdateSchemas = {
  body: UpdateSystemSettingsRequestSchema,
  responses: {
    200: z.object({
      data: SystemSettingListSchema,
    }),
  },
} satisfies OperationSchemas;

const systemSettingControllerUpdateOperation: OperationDefinition = {
  id: 'SystemSettingController_update',
  method: 'PATCH',
  path: '/system/settings',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: SystemSettingControllerUpdateSchemas,
};

/** 修改多個設定；值為 null 代表還原預設 */
export function systemSettingControllerUpdate(
  input: SystemSettingControllerUpdateInput,
  options?: RequestOptions,
): Promise<SystemSettingControllerUpdateResult> {
  return request<SystemSettingControllerUpdateResult>(
    systemSettingControllerUpdateOperation,
    input,
    options,
  );
}

// GET /system/settings/public

export const SystemSettingControllerListPublicSchemas = {
  responses: {
    200: z.object({
      data: PublicSystemSettingsSchema,
    }),
  },
} satisfies OperationSchemas;

const systemSettingControllerListPublicOperation: OperationDefinition = {
  id: 'SystemSettingController_listPublic',
  method: 'GET',
  path: '/system/settings/public',
  responseTypes: { 200: 'json' },
  schemas: SystemSettingControllerListPublicSchemas,
};

/** 公開設定（登入前就要用的，例如是否開放註冊） */
export function systemSettingControllerListPublic(
  options?: RequestOptions,
): Promise<SystemSettingControllerListPublicResult> {
  return request<SystemSettingControllerListPublicResult>(
    systemSettingControllerListPublicOperation,
    {},
    options,
  );
}
