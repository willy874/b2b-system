// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type { FeatureFlag, FeatureFlagList, UpdateFeatureFlagRequest } from '../models';
import type { ApiResponse } from '../runtime';
import { buildUrl } from '../url';

// GET /platform/feature-flags

export interface PlatformFeatureFlagControllerListResponses {
  200: {
    data: FeatureFlagList;
  };
}

export type PlatformFeatureFlagControllerListResponse =
  PlatformFeatureFlagControllerListResponses[200];

export type PlatformFeatureFlagControllerListResult = ApiResponse<
  200,
  PlatformFeatureFlagControllerListResponses[200]
>;

export function getPlatformFeatureFlagControllerListUrl(): string {
  return buildUrl('/platform/feature-flags');
}

// PUT /platform/feature-flags/{key}

export interface PlatformFeatureFlagControllerUpdatePathParams {
  key: string;
}

export type PlatformFeatureFlagControllerUpdateBody = UpdateFeatureFlagRequest;

export interface PlatformFeatureFlagControllerUpdateInput {
  path: PlatformFeatureFlagControllerUpdatePathParams;
  body: PlatformFeatureFlagControllerUpdateBody;
}

export interface PlatformFeatureFlagControllerUpdateResponses {
  200: {
    data: FeatureFlag;
  };
}

export type PlatformFeatureFlagControllerUpdateResponse =
  PlatformFeatureFlagControllerUpdateResponses[200];

export type PlatformFeatureFlagControllerUpdateResult = ApiResponse<
  200,
  PlatformFeatureFlagControllerUpdateResponses[200]
>;

export function getPlatformFeatureFlagControllerUpdateUrl(
  path: PlatformFeatureFlagControllerUpdatePathParams,
): string {
  return buildUrl('/platform/feature-flags/{key}', path);
}
