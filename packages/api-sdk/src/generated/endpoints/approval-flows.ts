// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type {
  ApprovalFlow,
  ApprovalFlowList,
  ApprovalFlowPreview,
  PreviewApprovalFlowRequest,
  PutApprovalFlowRequest,
} from '../models';
import type { ApiResponse } from '../runtime';
import { buildUrl } from '../url';

// GET /approval-flows

export interface ApprovalFlowControllerListResponses {
  200: {
    data: ApprovalFlowList;
  };
}

export type ApprovalFlowControllerListResponse = ApprovalFlowControllerListResponses[200];

export type ApprovalFlowControllerListResult = ApiResponse<
  200,
  ApprovalFlowControllerListResponses[200]
>;

export function getApprovalFlowControllerListUrl(): string {
  return buildUrl('/approval-flows');
}

// GET /approval-flows/{type}

export interface ApprovalFlowControllerGetPathParams {
  type: string;
}

export interface ApprovalFlowControllerGetInput {
  path: ApprovalFlowControllerGetPathParams;
}

export interface ApprovalFlowControllerGetResponses {
  200: {
    data: ApprovalFlow;
  };
}

export type ApprovalFlowControllerGetResponse = ApprovalFlowControllerGetResponses[200];

export type ApprovalFlowControllerGetResult = ApiResponse<
  200,
  ApprovalFlowControllerGetResponses[200]
>;

export function getApprovalFlowControllerGetUrl(path: ApprovalFlowControllerGetPathParams): string {
  return buildUrl('/approval-flows/{type}', path);
}

// PUT /approval-flows/{type}

export interface ApprovalFlowControllerPutPathParams {
  type: string;
}

export type ApprovalFlowControllerPutBody = PutApprovalFlowRequest;

export interface ApprovalFlowControllerPutInput {
  path: ApprovalFlowControllerPutPathParams;
  body: ApprovalFlowControllerPutBody;
}

export interface ApprovalFlowControllerPutResponses {
  200: {
    data: ApprovalFlow;
  };
}

export type ApprovalFlowControllerPutResponse = ApprovalFlowControllerPutResponses[200];

export type ApprovalFlowControllerPutResult = ApiResponse<
  200,
  ApprovalFlowControllerPutResponses[200]
>;

export function getApprovalFlowControllerPutUrl(path: ApprovalFlowControllerPutPathParams): string {
  return buildUrl('/approval-flows/{type}', path);
}

// POST /approval-flows/{type}/preview

export interface ApprovalFlowControllerPreviewPathParams {
  type: string;
}

export type ApprovalFlowControllerPreviewBody = PreviewApprovalFlowRequest;

export interface ApprovalFlowControllerPreviewInput {
  path: ApprovalFlowControllerPreviewPathParams;
  body: ApprovalFlowControllerPreviewBody;
}

export interface ApprovalFlowControllerPreviewResponses {
  200: {
    data: ApprovalFlowPreview;
  };
}

export type ApprovalFlowControllerPreviewResponse = ApprovalFlowControllerPreviewResponses[200];

export type ApprovalFlowControllerPreviewResult = ApiResponse<
  200,
  ApprovalFlowControllerPreviewResponses[200]
>;

export function getApprovalFlowControllerPreviewUrl(
  path: ApprovalFlowControllerPreviewPathParams,
): string {
  return buildUrl('/approval-flows/{type}/preview', path);
}
