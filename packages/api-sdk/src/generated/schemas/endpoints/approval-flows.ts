// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  ApprovalFlowControllerGetInput,
  ApprovalFlowControllerGetResult,
  ApprovalFlowControllerListResult,
  ApprovalFlowControllerPreviewInput,
  ApprovalFlowControllerPreviewResult,
  ApprovalFlowControllerPutInput,
  ApprovalFlowControllerPutResult,
  ApprovalFlowControllerStatsInput,
  ApprovalFlowControllerStatsResult,
} from '../../endpoints/approval-flows';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';
import {
  ApprovalFlowListSchema,
  ApprovalFlowPreviewSchema,
  ApprovalFlowSchema,
  ApprovalFlowStatsSchema,
  PreviewApprovalFlowRequestSchema,
  PutApprovalFlowRequestSchema,
} from '../components';

// GET /approval-flows

export const ApprovalFlowControllerListSchemas = {
  responses: {
    200: z.object({
      data: ApprovalFlowListSchema,
    }),
  },
} satisfies OperationSchemas;

const approvalFlowControllerListOperation: OperationDefinition = {
  id: 'ApprovalFlowController_list',
  method: 'GET',
  path: '/approval-flows',
  responseTypes: { 200: 'json' },
  schemas: ApprovalFlowControllerListSchemas,
};

/** 支援多階段流程的審批類型與它們的流程 */
export function approvalFlowControllerList(
  options?: RequestOptions,
): Promise<ApprovalFlowControllerListResult> {
  return request<ApprovalFlowControllerListResult>(
    approvalFlowControllerListOperation,
    {},
    options,
  );
}

// GET /approval-flows/{type}

export const ApprovalFlowControllerGetSchemas = {
  path: z.object({
    type: z.string(),
  }),
  responses: {
    200: z.object({
      data: ApprovalFlowSchema,
    }),
  },
} satisfies OperationSchemas;

const approvalFlowControllerGetOperation: OperationDefinition = {
  id: 'ApprovalFlowController_get',
  method: 'GET',
  path: '/approval-flows/{type}',
  responseTypes: { 200: 'json' },
  schemas: ApprovalFlowControllerGetSchemas,
};

export function approvalFlowControllerGet(
  input: ApprovalFlowControllerGetInput,
  options?: RequestOptions,
): Promise<ApprovalFlowControllerGetResult> {
  return request<ApprovalFlowControllerGetResult>(
    approvalFlowControllerGetOperation,
    input,
    options,
  );
}

// PUT /approval-flows/{type}

export const ApprovalFlowControllerPutSchemas = {
  path: z.object({
    type: z.string(),
  }),
  body: PutApprovalFlowRequestSchema,
  responses: {
    200: z.object({
      data: ApprovalFlowSchema,
    }),
  },
} satisfies OperationSchemas;

const approvalFlowControllerPutOperation: OperationDefinition = {
  id: 'ApprovalFlowController_put',
  method: 'PUT',
  path: '/approval-flows/{type}',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: ApprovalFlowControllerPutSchemas,
};

export function approvalFlowControllerPut(
  input: ApprovalFlowControllerPutInput,
  options?: RequestOptions,
): Promise<ApprovalFlowControllerPutResult> {
  return request<ApprovalFlowControllerPutResult>(
    approvalFlowControllerPutOperation,
    input,
    options,
  );
}

// GET /approval-flows/{type}/stats

export const ApprovalFlowControllerStatsSchemas = {
  path: z.object({
    type: z.string(),
  }),
  responses: {
    200: z.object({
      data: ApprovalFlowStatsSchema,
    }),
  },
} satisfies OperationSchemas;

const approvalFlowControllerStatsOperation: OperationDefinition = {
  id: 'ApprovalFlowController_stats',
  method: 'GET',
  path: '/approval-flows/{type}/stats',
  responseTypes: { 200: 'json' },
  schemas: ApprovalFlowControllerStatsSchemas,
};

/** 流程的實際運作（近 30 天） */
export function approvalFlowControllerStats(
  input: ApprovalFlowControllerStatsInput,
  options?: RequestOptions,
): Promise<ApprovalFlowControllerStatsResult> {
  return request<ApprovalFlowControllerStatsResult>(
    approvalFlowControllerStatsOperation,
    input,
    options,
  );
}

// POST /approval-flows/{type}/preview

export const ApprovalFlowControllerPreviewSchemas = {
  path: z.object({
    type: z.string(),
  }),
  body: PreviewApprovalFlowRequestSchema,
  responses: {
    200: z.object({
      data: ApprovalFlowPreviewSchema,
    }),
  },
} satisfies OperationSchemas;

const approvalFlowControllerPreviewOperation: OperationDefinition = {
  id: 'ApprovalFlowController_preview',
  method: 'POST',
  path: '/approval-flows/{type}/preview',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: ApprovalFlowControllerPreviewSchemas,
};

/** 試算流程會走哪些關卡、每關是誰 */
export function approvalFlowControllerPreview(
  input: ApprovalFlowControllerPreviewInput,
  options?: RequestOptions,
): Promise<ApprovalFlowControllerPreviewResult> {
  return request<ApprovalFlowControllerPreviewResult>(
    approvalFlowControllerPreviewOperation,
    input,
    options,
  );
}
