// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  PlatformCdnControllerCheckResult,
  PlatformCdnControllerOverviewResult,
  PlatformCdnControllerPurgeInput,
  PlatformCdnControllerPurgeResult,
  PlatformCdnControllerUpdateInput,
  PlatformCdnControllerUpdateResult,
} from '../../endpoints/platform-cdn';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';
import {
  CdnCheckResultSchema,
  CdnOverviewSchema,
  CdnPurgeRequestSchema,
  CdnPurgeResultSchema,
  UpdateCdnSettingsRequestSchema,
} from '../components';

// GET /platform/cdn

export const PlatformCdnControllerOverviewSchemas = {
  responses: {
    200: z.object({
      data: CdnOverviewSchema,
    }),
  },
} satisfies OperationSchemas;

const platformCdnControllerOverviewOperation: OperationDefinition = {
  id: 'PlatformCdnController_overview',
  method: 'GET',
  path: '/platform/cdn',
  responseTypes: { 200: 'json' },
  schemas: PlatformCdnControllerOverviewSchemas,
};

/** 部署資訊、存放的設定與生效值、最近一次檢查、最近的清理 */
export function platformCdnControllerOverview(
  options?: RequestOptions,
): Promise<PlatformCdnControllerOverviewResult> {
  return request<PlatformCdnControllerOverviewResult>(
    platformCdnControllerOverviewOperation,
    {},
    options,
  );
}

// PUT /platform/cdn/settings

export const PlatformCdnControllerUpdateSchemas = {
  body: UpdateCdnSettingsRequestSchema,
  responses: {
    200: z.object({
      data: CdnOverviewSchema,
    }),
  },
} satisfies OperationSchemas;

const platformCdnControllerUpdateOperation: OperationDefinition = {
  id: 'PlatformCdnController_update',
  method: 'PUT',
  path: '/platform/cdn/settings',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: PlatformCdnControllerUpdateSchemas,
};

/** 執行期的開關與參數：只帶要改的欄位與 version，null 回到跟著環境變數；開啟或加入資源類型前必須通過節點檢查 */
export function platformCdnControllerUpdate(
  input: PlatformCdnControllerUpdateInput,
  options?: RequestOptions,
): Promise<PlatformCdnControllerUpdateResult> {
  return request<PlatformCdnControllerUpdateResult>(
    platformCdnControllerUpdateOperation,
    input,
    options,
  );
}

// POST /platform/cdn/check

export const PlatformCdnControllerCheckSchemas = {
  responses: {
    200: z.object({
      data: CdnCheckResultSchema,
    }),
  },
} satisfies OperationSchemas;

const platformCdnControllerCheckOperation: OperationDefinition = {
  id: 'PlatformCdnController_check',
  method: 'POST',
  path: '/platform/cdn/check',
  responseTypes: { 200: 'json' },
  schemas: PlatformCdnControllerCheckSchemas,
};

/** 執行邊緣的檢查（10 秒內重複呼叫回上一次的結果） */
export function platformCdnControllerCheck(
  options?: RequestOptions,
): Promise<PlatformCdnControllerCheckResult> {
  return request<PlatformCdnControllerCheckResult>(
    platformCdnControllerCheckOperation,
    {},
    options,
  );
}

// POST /platform/cdn/purge

export const PlatformCdnControllerPurgeSchemas = {
  body: CdnPurgeRequestSchema,
  responses: {
    202: z.object({
      data: CdnPurgeResultSchema,
    }),
  },
} satisfies OperationSchemas;

const platformCdnControllerPurgeOperation: OperationDefinition = {
  id: 'PlatformCdnController_purge',
  method: 'POST',
  path: '/platform/cdn/purge',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 202: 'json' },
  schemas: PlatformCdnControllerPurgeSchemas,
};

/** 手動清理：路徑、資源（解析出所有路徑）或整個快取（另要 cdn:purgeAll）；排入 cdn.purge */
export function platformCdnControllerPurge(
  input: PlatformCdnControllerPurgeInput,
  options?: RequestOptions,
): Promise<PlatformCdnControllerPurgeResult> {
  return request<PlatformCdnControllerPurgeResult>(
    platformCdnControllerPurgeOperation,
    input,
    options,
  );
}
