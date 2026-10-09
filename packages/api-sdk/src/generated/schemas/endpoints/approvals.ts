// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  ApprovalControllerApproveInput,
  ApprovalControllerApproveResult,
  ApprovalControllerCountsResult,
  ApprovalControllerDecideInput,
  ApprovalControllerDecideResult,
  ApprovalControllerFindOneInput,
  ApprovalControllerFindOneResult,
  ApprovalControllerListResult,
  ApprovalControllerOverrideInput,
  ApprovalControllerOverrideResult,
  ApprovalControllerRefreshInput,
  ApprovalControllerRefreshResult,
  ApprovalControllerRejectInput,
  ApprovalControllerRejectResult,
  ApprovalControllerWithdrawInput,
  ApprovalControllerWithdrawResult,
} from '../../endpoints/approvals';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';
import {
  ApprovalCountsSchema,
  ApprovalRequestDetailSchema,
  ApprovalRequestSchema,
  ApproveApprovalRequestSchema,
  DecideApprovalStepRequestSchema,
  OverrideApprovalStepRequestSchema,
  RejectApprovalRequestSchema,
} from '../components';

// GET /approvals

export const ApprovalControllerListSchemas = {
  responses: {
    200: z.object({
      data: z.object({
        items: z.array(ApprovalRequestSchema),
        pagination: z.object({
          offset: z.int(),
          limit: z.int(),
          total: z.int(),
        }),
      }),
    }),
  },
} satisfies OperationSchemas;

const approvalControllerListOperation: OperationDefinition = {
  id: 'ApprovalController_list',
  method: 'GET',
  path: '/approvals',
  responseTypes: { 200: 'json' },
  schemas: ApprovalControllerListSchemas,
};

/** 審批請求列表（全部／待我審核／我送出的） */
export function approvalControllerList(
  options?: RequestOptions,
): Promise<ApprovalControllerListResult> {
  return request<ApprovalControllerListResult>(approvalControllerListOperation, {}, options);
}

// GET /approvals/counts

export const ApprovalControllerCountsSchemas = {
  responses: {
    200: z.object({
      data: ApprovalCountsSchema,
    }),
  },
} satisfies OperationSchemas;

const approvalControllerCountsOperation: OperationDefinition = {
  id: 'ApprovalController_counts',
  method: 'GET',
  path: '/approvals/counts',
  responseTypes: { 200: 'json' },
  schemas: ApprovalControllerCountsSchemas,
};

/** 待審數（待我審核、全部的待審） */
export function approvalControllerCounts(
  options?: RequestOptions,
): Promise<ApprovalControllerCountsResult> {
  return request<ApprovalControllerCountsResult>(approvalControllerCountsOperation, {}, options);
}

// GET /approvals/{id}

export const ApprovalControllerFindOneSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: ApprovalRequestDetailSchema,
    }),
  },
} satisfies OperationSchemas;

const approvalControllerFindOneOperation: OperationDefinition = {
  id: 'ApprovalController_findOne',
  method: 'GET',
  path: '/approvals/{id}',
  responseTypes: { 200: 'json' },
  schemas: ApprovalControllerFindOneSchemas,
};

export function approvalControllerFindOne(
  input: ApprovalControllerFindOneInput,
  options?: RequestOptions,
): Promise<ApprovalControllerFindOneResult> {
  return request<ApprovalControllerFindOneResult>(
    approvalControllerFindOneOperation,
    input,
    options,
  );
}

// POST /approvals/{id}/approve

export const ApprovalControllerApproveSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: ApproveApprovalRequestSchema,
  responses: {
    200: z.object({
      data: ApprovalRequestSchema,
    }),
  },
} satisfies OperationSchemas;

const approvalControllerApproveOperation: OperationDefinition = {
  id: 'ApprovalController_approve',
  method: 'POST',
  path: '/approvals/{id}/approve',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: ApprovalControllerApproveSchemas,
};

/** 核准（另需該類型要求的權限，例：user.register 需要 user:create） */
export function approvalControllerApprove(
  input: ApprovalControllerApproveInput,
  options?: RequestOptions,
): Promise<ApprovalControllerApproveResult> {
  return request<ApprovalControllerApproveResult>(
    approvalControllerApproveOperation,
    input,
    options,
  );
}

// POST /approvals/{id}/reject

export const ApprovalControllerRejectSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: RejectApprovalRequestSchema,
  responses: {
    200: z.object({
      data: ApprovalRequestSchema,
    }),
  },
} satisfies OperationSchemas;

const approvalControllerRejectOperation: OperationDefinition = {
  id: 'ApprovalController_reject',
  method: 'POST',
  path: '/approvals/{id}/reject',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: ApprovalControllerRejectSchemas,
};

/** 駁回 */
export function approvalControllerReject(
  input: ApprovalControllerRejectInput,
  options?: RequestOptions,
): Promise<ApprovalControllerRejectResult> {
  return request<ApprovalControllerRejectResult>(approvalControllerRejectOperation, input, options);
}

// POST /approvals/{id}/withdraw

export const ApprovalControllerWithdrawSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: ApprovalRequestDetailSchema,
    }),
  },
} satisfies OperationSchemas;

const approvalControllerWithdrawOperation: OperationDefinition = {
  id: 'ApprovalController_withdraw',
  method: 'POST',
  path: '/approvals/{id}/withdraw',
  responseTypes: { 200: 'json' },
  schemas: ApprovalControllerWithdrawSchemas,
};

/** 撤回自己送出的申請 */
export function approvalControllerWithdraw(
  input: ApprovalControllerWithdrawInput,
  options?: RequestOptions,
): Promise<ApprovalControllerWithdrawResult> {
  return request<ApprovalControllerWithdrawResult>(
    approvalControllerWithdrawOperation,
    input,
    options,
  );
}

// POST /approvals/{id}/steps/{ordinal}/decisions

export const ApprovalControllerDecideSchemas = {
  path: z.object({
    id: z.string(),
    ordinal: z.number(),
  }),
  body: DecideApprovalStepRequestSchema,
  responses: {
    200: z.object({
      data: ApprovalRequestDetailSchema,
    }),
  },
} satisfies OperationSchemas;

const approvalControllerDecideOperation: OperationDefinition = {
  id: 'ApprovalController_decide',
  method: 'POST',
  path: '/approvals/{id}/steps/{ordinal}/decisions',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: ApprovalControllerDecideSchemas,
};

/** 在目前的關卡同意或駁回 */
export function approvalControllerDecide(
  input: ApprovalControllerDecideInput,
  options?: RequestOptions,
): Promise<ApprovalControllerDecideResult> {
  return request<ApprovalControllerDecideResult>(approvalControllerDecideOperation, input, options);
}

// POST /approvals/{id}/steps/{ordinal}/override

export const ApprovalControllerOverrideSchemas = {
  path: z.object({
    id: z.string(),
    ordinal: z.number(),
  }),
  body: OverrideApprovalStepRequestSchema,
  responses: {
    200: z.object({
      data: ApprovalRequestDetailSchema,
    }),
  },
} satisfies OperationSchemas;

const approvalControllerOverrideOperation: OperationDefinition = {
  id: 'ApprovalController_override',
  method: 'POST',
  path: '/approvals/{id}/steps/{ordinal}/override',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: ApprovalControllerOverrideSchemas,
};

/** 強制定案目前的關卡 */
export function approvalControllerOverride(
  input: ApprovalControllerOverrideInput,
  options?: RequestOptions,
): Promise<ApprovalControllerOverrideResult> {
  return request<ApprovalControllerOverrideResult>(
    approvalControllerOverrideOperation,
    input,
    options,
  );
}

// POST /approvals/{id}/steps/{ordinal}/refresh

export const ApprovalControllerRefreshSchemas = {
  path: z.object({
    id: z.string(),
    ordinal: z.number(),
  }),
  responses: {
    200: z.object({
      data: ApprovalRequestDetailSchema,
    }),
  },
} satisfies OperationSchemas;

const approvalControllerRefreshOperation: OperationDefinition = {
  id: 'ApprovalController_refresh',
  method: 'POST',
  path: '/approvals/{id}/steps/{ordinal}/refresh',
  responseTypes: { 200: 'json' },
  schemas: ApprovalControllerRefreshSchemas,
};

/** 重新展開目前關卡的審核者 */
export function approvalControllerRefresh(
  input: ApprovalControllerRefreshInput,
  options?: RequestOptions,
): Promise<ApprovalControllerRefreshResult> {
  return request<ApprovalControllerRefreshResult>(
    approvalControllerRefreshOperation,
    input,
    options,
  );
}
