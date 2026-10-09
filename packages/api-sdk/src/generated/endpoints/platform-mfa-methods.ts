// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type {
  MfaMethodImpact,
  MfaMethodSettings,
  PlatformMfaMethod,
  PlatformMfaMethodList,
  UpdateMfaMethodSettingsRequest,
  UpdatePlatformMfaMethodRequest,
} from '../models';
import type { ApiResponse } from '../runtime';
import { buildUrl } from '../url';

// GET /platform/mfa-methods

export interface PlatformMfaMethodControllerListResponses {
  200: {
    data: PlatformMfaMethodList;
  };
}

export type PlatformMfaMethodControllerListResponse = PlatformMfaMethodControllerListResponses[200];

export type PlatformMfaMethodControllerListResult = ApiResponse<
  200,
  PlatformMfaMethodControllerListResponses[200]
>;

export function getPlatformMfaMethodControllerListUrl(): string {
  return buildUrl('/platform/mfa-methods');
}

// GET /platform/mfa-methods/{id}/impact

export interface PlatformMfaMethodControllerImpactPathParams {
  id: string;
}

export interface PlatformMfaMethodControllerImpactInput {
  path: PlatformMfaMethodControllerImpactPathParams;
}

export interface PlatformMfaMethodControllerImpactResponses {
  200: {
    data: MfaMethodImpact;
  };
}

export type PlatformMfaMethodControllerImpactResponse =
  PlatformMfaMethodControllerImpactResponses[200];

export type PlatformMfaMethodControllerImpactResult = ApiResponse<
  200,
  PlatformMfaMethodControllerImpactResponses[200]
>;

export function getPlatformMfaMethodControllerImpactUrl(
  path: PlatformMfaMethodControllerImpactPathParams,
): string {
  return buildUrl('/platform/mfa-methods/{id}/impact', path);
}

// GET /platform/mfa-methods/{id}/settings

export interface PlatformMfaMethodControllerGetSettingsPathParams {
  id: string;
}

export interface PlatformMfaMethodControllerGetSettingsInput {
  path: PlatformMfaMethodControllerGetSettingsPathParams;
}

export interface PlatformMfaMethodControllerGetSettingsResponses {
  200: {
    data: MfaMethodSettings;
  };
}

export type PlatformMfaMethodControllerGetSettingsResponse =
  PlatformMfaMethodControllerGetSettingsResponses[200];

export type PlatformMfaMethodControllerGetSettingsResult = ApiResponse<
  200,
  PlatformMfaMethodControllerGetSettingsResponses[200]
>;

export function getPlatformMfaMethodControllerGetSettingsUrl(
  path: PlatformMfaMethodControllerGetSettingsPathParams,
): string {
  return buildUrl('/platform/mfa-methods/{id}/settings', path);
}

// PUT /platform/mfa-methods/{id}/settings

export interface PlatformMfaMethodControllerSaveSettingsPathParams {
  id: string;
}

export type PlatformMfaMethodControllerSaveSettingsBody = UpdateMfaMethodSettingsRequest;

export interface PlatformMfaMethodControllerSaveSettingsInput {
  path: PlatformMfaMethodControllerSaveSettingsPathParams;
  body: PlatformMfaMethodControllerSaveSettingsBody;
}

export interface PlatformMfaMethodControllerSaveSettingsResponses {
  200: {
    data: MfaMethodSettings;
  };
}

export type PlatformMfaMethodControllerSaveSettingsResponse =
  PlatformMfaMethodControllerSaveSettingsResponses[200];

export type PlatformMfaMethodControllerSaveSettingsResult = ApiResponse<
  200,
  PlatformMfaMethodControllerSaveSettingsResponses[200]
>;

export function getPlatformMfaMethodControllerSaveSettingsUrl(
  path: PlatformMfaMethodControllerSaveSettingsPathParams,
): string {
  return buildUrl('/platform/mfa-methods/{id}/settings', path);
}

// DELETE /platform/mfa-methods/{id}/settings

export interface PlatformMfaMethodControllerClearSettingsPathParams {
  id: string;
}

export interface PlatformMfaMethodControllerClearSettingsInput {
  path: PlatformMfaMethodControllerClearSettingsPathParams;
}

export interface PlatformMfaMethodControllerClearSettingsResponses {
  200: {
    data: MfaMethodSettings;
  };
}

export type PlatformMfaMethodControllerClearSettingsResponse =
  PlatformMfaMethodControllerClearSettingsResponses[200];

export type PlatformMfaMethodControllerClearSettingsResult = ApiResponse<
  200,
  PlatformMfaMethodControllerClearSettingsResponses[200]
>;

export function getPlatformMfaMethodControllerClearSettingsUrl(
  path: PlatformMfaMethodControllerClearSettingsPathParams,
): string {
  return buildUrl('/platform/mfa-methods/{id}/settings', path);
}

// PUT /platform/mfa-methods/{id}

export interface PlatformMfaMethodControllerUpdatePathParams {
  id: string;
}

export type PlatformMfaMethodControllerUpdateBody = UpdatePlatformMfaMethodRequest;

export interface PlatformMfaMethodControllerUpdateInput {
  path: PlatformMfaMethodControllerUpdatePathParams;
  body: PlatformMfaMethodControllerUpdateBody;
}

export interface PlatformMfaMethodControllerUpdateResponses {
  200: {
    data: PlatformMfaMethod;
  };
}

export type PlatformMfaMethodControllerUpdateResponse =
  PlatformMfaMethodControllerUpdateResponses[200];

export type PlatformMfaMethodControllerUpdateResult = ApiResponse<
  200,
  PlatformMfaMethodControllerUpdateResponses[200]
>;

export function getPlatformMfaMethodControllerUpdateUrl(
  path: PlatformMfaMethodControllerUpdatePathParams,
): string {
  return buildUrl('/platform/mfa-methods/{id}', path);
}
