// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type {
  PublicSystemSettings,
  SystemSettingList,
  UpdateSystemSettingsRequest,
} from '../models';
import type { ApiResponse } from '../runtime';
import { buildUrl } from '../url';

// GET /system/info

export interface SystemControllerInfoResponses {
  200: undefined;
}

export type SystemControllerInfoResponse = SystemControllerInfoResponses[200];

export type SystemControllerInfoResult = ApiResponse<200, SystemControllerInfoResponses[200]>;

export function getSystemControllerInfoUrl(): string {
  return buildUrl('/system/info');
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

export function getSystemSettingControllerListUrl(): string {
  return buildUrl('/system/settings');
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

export function getSystemSettingControllerUpdateUrl(): string {
  return buildUrl('/system/settings');
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

export function getSystemSettingControllerListPublicUrl(): string {
  return buildUrl('/system/settings/public');
}
