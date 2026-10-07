// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  PlatformMfaMethodControllerImpactInput,
  PlatformMfaMethodControllerImpactResult,
  PlatformMfaMethodControllerListResult,
  PlatformMfaMethodControllerUpdateInput,
  PlatformMfaMethodControllerUpdateResult,
} from '../../endpoints/platform-mfa-methods';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';
import {
  MfaMethodImpactSchema,
  PlatformMfaMethodListSchema,
  PlatformMfaMethodSchema,
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
