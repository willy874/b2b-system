// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type {
  CdnCheckResult,
  CdnOverview,
  CdnPurgeRequest,
  CdnPurgeResult,
  UpdateCdnSettingsRequest,
} from '../models';
import type { ApiResponse } from '../runtime';
import { buildUrl } from '../url';

// GET /platform/cdn

export interface PlatformCdnControllerOverviewResponses {
  200: {
    data: CdnOverview;
  };
}

export type PlatformCdnControllerOverviewResponse = PlatformCdnControllerOverviewResponses[200];

export type PlatformCdnControllerOverviewResult = ApiResponse<
  200,
  PlatformCdnControllerOverviewResponses[200]
>;

export function getPlatformCdnControllerOverviewUrl(): string {
  return buildUrl('/platform/cdn');
}

// PUT /platform/cdn/settings

export type PlatformCdnControllerUpdateBody = UpdateCdnSettingsRequest;

export interface PlatformCdnControllerUpdateInput {
  body: PlatformCdnControllerUpdateBody;
}

export interface PlatformCdnControllerUpdateResponses {
  200: {
    data: CdnOverview;
  };
}

export type PlatformCdnControllerUpdateResponse = PlatformCdnControllerUpdateResponses[200];

export type PlatformCdnControllerUpdateResult = ApiResponse<
  200,
  PlatformCdnControllerUpdateResponses[200]
>;

export function getPlatformCdnControllerUpdateUrl(): string {
  return buildUrl('/platform/cdn/settings');
}

// POST /platform/cdn/check

export interface PlatformCdnControllerCheckResponses {
  200: {
    data: CdnCheckResult;
  };
}

export type PlatformCdnControllerCheckResponse = PlatformCdnControllerCheckResponses[200];

export type PlatformCdnControllerCheckResult = ApiResponse<
  200,
  PlatformCdnControllerCheckResponses[200]
>;

export function getPlatformCdnControllerCheckUrl(): string {
  return buildUrl('/platform/cdn/check');
}

// POST /platform/cdn/purge

export type PlatformCdnControllerPurgeBody = CdnPurgeRequest;

export interface PlatformCdnControllerPurgeInput {
  body: PlatformCdnControllerPurgeBody;
}

export interface PlatformCdnControllerPurgeResponses {
  202: {
    data: CdnPurgeResult;
  };
}

export type PlatformCdnControllerPurgeResponse = PlatformCdnControllerPurgeResponses[202];

export type PlatformCdnControllerPurgeResult = ApiResponse<
  202,
  PlatformCdnControllerPurgeResponses[202]
>;

export function getPlatformCdnControllerPurgeUrl(): string {
  return buildUrl('/platform/cdn/purge');
}
