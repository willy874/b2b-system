// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type { ApprovalRequest, ApproveApprovalRequest, RejectApprovalRequest } from '../models';
import type { ApiResponse } from '../runtime';
import { buildUrl } from '../url';

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

export function getApprovalControllerListUrl(): string {
  return buildUrl('/approvals');
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

export function getApprovalControllerFindOneUrl(path: ApprovalControllerFindOnePathParams): string {
  return buildUrl('/approvals/{id}', path);
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

export function getApprovalControllerApproveUrl(path: ApprovalControllerApprovePathParams): string {
  return buildUrl('/approvals/{id}/approve', path);
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

export function getApprovalControllerRejectUrl(path: ApprovalControllerRejectPathParams): string {
  return buildUrl('/approvals/{id}/reject', path);
}
