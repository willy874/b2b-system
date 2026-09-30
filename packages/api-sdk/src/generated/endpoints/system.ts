// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  PublicSystemSettings,
  SystemSettingList,
  UpdateSystemSettingsRequest,
} from '../models';
import { buildUrl, request } from '../runtime';
import type {
  ApiResponse,
  OperationDefinition,
  OperationSchemas,
  RequestOptions,
} from '../runtime';
import {
  PublicSystemSettingsSchema,
  SystemSettingListSchema,
  UpdateSystemSettingsRequestSchema,
} from '../schemas';

// GET /system/info

export interface SystemControllerInfoResponses {
  200: undefined;
}

export type SystemControllerInfoResponse = SystemControllerInfoResponses[200];

export type SystemControllerInfoResult = ApiResponse<200, SystemControllerInfoResponses[200]>;

export const SystemControllerInfoSchemas = {} satisfies OperationSchemas;

export function getSystemControllerInfoUrl(): string {
  return buildUrl('/system/info');
}

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

export interface SystemSettingControllerListResponses {
  200: {
    data: SystemSettingList;
  };
}

export type SystemSettingControllerListResponse = SystemSettingControllerListResponses[200];

export type SystemSettingControllerListResult = ApiResponse<
  200,
  SystemSettingControllerListResponses[200]
>;

export const SystemSettingControllerListSchemas = {
  responses: {
    200: z.object({
      data: SystemSettingListSchema,
    }),
  },
} satisfies OperationSchemas;

export function getSystemSettingControllerListUrl(): string {
  return buildUrl('/system/settings');
}

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

export type SystemSettingControllerUpdateBody = UpdateSystemSettingsRequest;

export interface SystemSettingControllerUpdateInput {
  body: SystemSettingControllerUpdateBody;
}

export interface SystemSettingControllerUpdateResponses {
  200: {
    data: SystemSettingList;
  };
}

export type SystemSettingControllerUpdateResponse = SystemSettingControllerUpdateResponses[200];

export type SystemSettingControllerUpdateResult = ApiResponse<
  200,
  SystemSettingControllerUpdateResponses[200]
>;

export const SystemSettingControllerUpdateSchemas = {
  body: UpdateSystemSettingsRequestSchema,
  responses: {
    200: z.object({
      data: SystemSettingListSchema,
    }),
  },
} satisfies OperationSchemas;

export function getSystemSettingControllerUpdateUrl(): string {
  return buildUrl('/system/settings');
}

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

export interface SystemSettingControllerListPublicResponses {
  200: {
    data: PublicSystemSettings;
  };
}

export type SystemSettingControllerListPublicResponse =
  SystemSettingControllerListPublicResponses[200];

export type SystemSettingControllerListPublicResult = ApiResponse<
  200,
  SystemSettingControllerListPublicResponses[200]
>;

export const SystemSettingControllerListPublicSchemas = {
  responses: {
    200: z.object({
      data: PublicSystemSettingsSchema,
    }),
  },
} satisfies OperationSchemas;

export function getSystemSettingControllerListPublicUrl(): string {
  return buildUrl('/system/settings/public');
}

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
