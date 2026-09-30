// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type { ApprovalRequest, ApproveApprovalRequest, RejectApprovalRequest } from '../models';
import { buildUrl, request } from '../runtime';
import type {
  ApiResponse,
  OperationDefinition,
  OperationSchemas,
  RequestOptions,
} from '../runtime';
import {
  ApprovalRequestSchema,
  ApproveApprovalRequestSchema,
  RejectApprovalRequestSchema,
} from '../schemas';

// GET /approvals

export interface ApprovalControllerListResponses {
  200: {
    data: {
      items: Array<ApprovalRequest>;
      pagination: {
        offset: number;
        limit: number;
        total: number;
      };
    };
  };
}

export type ApprovalControllerListResponse = ApprovalControllerListResponses[200];

export type ApprovalControllerListResult = ApiResponse<200, ApprovalControllerListResponses[200]>;

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

export function getApprovalControllerListUrl(): string {
  return buildUrl('/approvals');
}

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

export interface ApprovalControllerFindOnePathParams {
  id: string;
}

export interface ApprovalControllerFindOneInput {
  path: ApprovalControllerFindOnePathParams;
}

export interface ApprovalControllerFindOneResponses {
  200: {
    data: ApprovalRequest;
  };
}

export type ApprovalControllerFindOneResponse = ApprovalControllerFindOneResponses[200];

export type ApprovalControllerFindOneResult = ApiResponse<
  200,
  ApprovalControllerFindOneResponses[200]
>;

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

export function getApprovalControllerFindOneUrl(path: ApprovalControllerFindOnePathParams): string {
  return buildUrl('/approvals/{id}', path);
}

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

export interface ApprovalControllerApprovePathParams {
  id: string;
}

export type ApprovalControllerApproveBody = ApproveApprovalRequest;

export interface ApprovalControllerApproveInput {
  path: ApprovalControllerApprovePathParams;
  body: ApprovalControllerApproveBody;
}

export interface ApprovalControllerApproveResponses {
  200: {
    data: ApprovalRequest;
  };
}

export type ApprovalControllerApproveResponse = ApprovalControllerApproveResponses[200];

export type ApprovalControllerApproveResult = ApiResponse<
  200,
  ApprovalControllerApproveResponses[200]
>;

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

export function getApprovalControllerApproveUrl(path: ApprovalControllerApprovePathParams): string {
  return buildUrl('/approvals/{id}/approve', path);
}

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

export interface ApprovalControllerRejectPathParams {
  id: string;
}

export type ApprovalControllerRejectBody = RejectApprovalRequest;

export interface ApprovalControllerRejectInput {
  path: ApprovalControllerRejectPathParams;
  body: ApprovalControllerRejectBody;
}

export interface ApprovalControllerRejectResponses {
  200: {
    data: ApprovalRequest;
  };
}

export type ApprovalControllerRejectResponse = ApprovalControllerRejectResponses[200];

export type ApprovalControllerRejectResult = ApiResponse<
  200,
  ApprovalControllerRejectResponses[200]
>;

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

export function getApprovalControllerRejectUrl(path: ApprovalControllerRejectPathParams): string {
  return buildUrl('/approvals/{id}/reject', path);
}

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
