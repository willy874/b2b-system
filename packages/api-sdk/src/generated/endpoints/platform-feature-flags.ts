// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type { FeatureFlag, FeatureFlagList, UpdateFeatureFlagRequest } from '../models';
import { buildUrl, request } from '../runtime';
import type {
  ApiResponse,
  OperationDefinition,
  OperationSchemas,
  RequestOptions,
} from '../runtime';
import {
  FeatureFlagListSchema,
  FeatureFlagSchema,
  UpdateFeatureFlagRequestSchema,
} from '../schemas';

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

export const PlatformFeatureFlagControllerListSchemas = {
  responses: {
    200: z.object({
      data: FeatureFlagListSchema,
    }),
  },
} satisfies OperationSchemas;

export function getPlatformFeatureFlagControllerListUrl(): string {
  return buildUrl('/platform/feature-flags');
}

const platformFeatureFlagControllerListOperation: OperationDefinition = {
  id: 'PlatformFeatureFlagController_list',
  method: 'GET',
  path: '/platform/feature-flags',
  responseTypes: { 200: 'json' },
  schemas: PlatformFeatureFlagControllerListSchemas,
};

/** feature flag 的目錄、全平台覆寫與覆寫它的租戶數 */
export function platformFeatureFlagControllerList(
  options?: RequestOptions,
): Promise<PlatformFeatureFlagControllerListResult> {
  return request<PlatformFeatureFlagControllerListResult>(
    platformFeatureFlagControllerListOperation,
    {},
    options,
  );
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

export const PlatformFeatureFlagControllerUpdateSchemas = {
  path: z.object({
    key: z.string(),
  }),
  body: UpdateFeatureFlagRequestSchema,
  responses: {
    200: z.object({
      data: FeatureFlagSchema,
    }),
  },
} satisfies OperationSchemas;

export function getPlatformFeatureFlagControllerUpdateUrl(
  path: PlatformFeatureFlagControllerUpdatePathParams,
): string {
  return buildUrl('/platform/feature-flags/{key}', path);
}

const platformFeatureFlagControllerUpdateOperation: OperationDefinition = {
  id: 'PlatformFeatureFlagController_update',
  method: 'PUT',
  path: '/platform/feature-flags/{key}',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: PlatformFeatureFlagControllerUpdateSchemas,
};

/** 全平台層的覆寫：on（全面開放）、off（緊急關閉，蓋過租戶層）、default（移除覆寫） */
export function platformFeatureFlagControllerUpdate(
  input: PlatformFeatureFlagControllerUpdateInput,
  options?: RequestOptions,
): Promise<PlatformFeatureFlagControllerUpdateResult> {
  return request<PlatformFeatureFlagControllerUpdateResult>(
    platformFeatureFlagControllerUpdateOperation,
    input,
    options,
  );
}
