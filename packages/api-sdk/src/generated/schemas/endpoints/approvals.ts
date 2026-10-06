// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  ApprovalControllerApproveInput,
  ApprovalControllerApproveResult,
  ApprovalControllerFindOneInput,
  ApprovalControllerFindOneResult,
  ApprovalControllerListResult,
  ApprovalControllerRejectInput,
  ApprovalControllerRejectResult,
} from '../../endpoints/approvals';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';
import {
  ApprovalRequestSchema,
  ApproveApprovalRequestSchema,
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

/** 審批請求列表 */
export function approvalControllerList(
  options?: RequestOptions,
): Promise<ApprovalControllerListResult> {
  return request<ApprovalControllerListResult>(approvalControllerListOperation, {}, options);
}

// GET /approvals/{id}

export const ApprovalControllerFindOneSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: ApprovalRequestSchema,
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
