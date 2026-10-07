// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  MfaPolicyControllerGetResult,
  MfaPolicyControllerPreviewInput,
  MfaPolicyControllerPreviewResult,
  MfaPolicyControllerUpdateInput,
  MfaPolicyControllerUpdateResult,
} from '../../endpoints/mfa';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';
import {
  MfaPolicyImpactSchema,
  MfaPolicySchema,
  UpdateMfaPolicyRequestSchema,
} from '../components';

// GET /mfa/policy

export const MfaPolicyControllerGetSchemas = {
  responses: {
    200: z.object({
      data: MfaPolicySchema,
    }),
  },
} satisfies OperationSchemas;

const mfaPolicyControllerGetOperation: OperationDefinition = {
  id: 'MfaPolicyController_get',
  method: 'GET',
  path: '/mfa/policy',
  responseTypes: { 200: 'json' },
  schemas: MfaPolicyControllerGetSchemas,
};

/** 租戶的 MFA 政策、可選的方式、不符合政策的人數 */
export function mfaPolicyControllerGet(
  options?: RequestOptions,
): Promise<MfaPolicyControllerGetResult> {
  return request<MfaPolicyControllerGetResult>(mfaPolicyControllerGetOperation, {}, options);
}

// PUT /mfa/policy

export const MfaPolicyControllerUpdateSchemas = {
  body: UpdateMfaPolicyRequestSchema,
  responses: {
    200: z.object({
      data: MfaPolicySchema,
    }),
  },
} satisfies OperationSchemas;

const mfaPolicyControllerUpdateOperation: OperationDefinition = {
  id: 'MfaPolicyController_update',
  method: 'PUT',
  path: '/mfa/policy',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: MfaPolicyControllerUpdateSchemas,
};

/** 修改 MFA 政策（樂觀鎖；收緊立即生效但不踢人） */
export function mfaPolicyControllerUpdate(
  input: MfaPolicyControllerUpdateInput,
  options?: RequestOptions,
): Promise<MfaPolicyControllerUpdateResult> {
  return request<MfaPolicyControllerUpdateResult>(
    mfaPolicyControllerUpdateOperation,
    input,
    options,
  );
}

// POST /mfa/policy/preview

export const MfaPolicyControllerPreviewSchemas = {
  body: UpdateMfaPolicyRequestSchema,
  responses: {
    200: z.object({
      data: MfaPolicyImpactSchema,
    }),
  },
} satisfies OperationSchemas;

const mfaPolicyControllerPreviewOperation: OperationDefinition = {
  id: 'MfaPolicyController_preview',
  method: 'POST',
  path: '/mfa/policy/preview',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: MfaPolicyControllerPreviewSchemas,
};

/** 套用前先看影響：不符合政策的人數、會被擋在門外的人數 */
export function mfaPolicyControllerPreview(
  input: MfaPolicyControllerPreviewInput,
  options?: RequestOptions,
): Promise<MfaPolicyControllerPreviewResult> {
  return request<MfaPolicyControllerPreviewResult>(
    mfaPolicyControllerPreviewOperation,
    input,
    options,
  );
}
