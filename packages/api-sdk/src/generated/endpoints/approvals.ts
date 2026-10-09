// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type {
  ApprovalCounts,
  ApprovalRequest,
  ApprovalRequestDetail,
  ApproveApprovalRequest,
  DecideApprovalStepRequest,
  OverrideApprovalStepRequest,
  RejectApprovalRequest,
} from '../models';
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

// GET /approvals/counts

export interface ApprovalControllerCountsResponses {
  200: {
    data: ApprovalCounts;
  };
}

export type ApprovalControllerCountsResponse = ApprovalControllerCountsResponses[200];

export type ApprovalControllerCountsResult = ApiResponse<
  200,
  ApprovalControllerCountsResponses[200]
>;

export function getApprovalControllerCountsUrl(): string {
  return buildUrl('/approvals/counts');
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
    data: ApprovalRequestDetail;
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

// POST /approvals/{id}/withdraw

export interface ApprovalControllerWithdrawPathParams {
  id: string;
}

export interface ApprovalControllerWithdrawInput {
  path: ApprovalControllerWithdrawPathParams;
}

export interface ApprovalControllerWithdrawResponses {
  200: {
    data: ApprovalRequestDetail;
  };
}

export type ApprovalControllerWithdrawResponse = ApprovalControllerWithdrawResponses[200];

export type ApprovalControllerWithdrawResult = ApiResponse<
  200,
  ApprovalControllerWithdrawResponses[200]
>;

export function getApprovalControllerWithdrawUrl(
  path: ApprovalControllerWithdrawPathParams,
): string {
  return buildUrl('/approvals/{id}/withdraw', path);
}

// POST /approvals/{id}/steps/{ordinal}/decisions

export interface ApprovalControllerDecidePathParams {
  id: string;
  ordinal: number;
}

export type ApprovalControllerDecideBody = DecideApprovalStepRequest;

export interface ApprovalControllerDecideInput {
  path: ApprovalControllerDecidePathParams;
  body: ApprovalControllerDecideBody;
}

export interface ApprovalControllerDecideResponses {
  200: {
    data: ApprovalRequestDetail;
  };
}

export type ApprovalControllerDecideResponse = ApprovalControllerDecideResponses[200];

export type ApprovalControllerDecideResult = ApiResponse<
  200,
  ApprovalControllerDecideResponses[200]
>;

export function getApprovalControllerDecideUrl(path: ApprovalControllerDecidePathParams): string {
  return buildUrl('/approvals/{id}/steps/{ordinal}/decisions', path);
}

// POST /approvals/{id}/steps/{ordinal}/override

export interface ApprovalControllerOverridePathParams {
  id: string;
  ordinal: number;
}

export type ApprovalControllerOverrideBody = OverrideApprovalStepRequest;

export interface ApprovalControllerOverrideInput {
  path: ApprovalControllerOverridePathParams;
  body: ApprovalControllerOverrideBody;
}

export interface ApprovalControllerOverrideResponses {
  200: {
    data: ApprovalRequestDetail;
  };
}

export type ApprovalControllerOverrideResponse = ApprovalControllerOverrideResponses[200];

export type ApprovalControllerOverrideResult = ApiResponse<
  200,
  ApprovalControllerOverrideResponses[200]
>;

export function getApprovalControllerOverrideUrl(
  path: ApprovalControllerOverridePathParams,
): string {
  return buildUrl('/approvals/{id}/steps/{ordinal}/override', path);
}

// POST /approvals/{id}/steps/{ordinal}/refresh

export interface ApprovalControllerRefreshPathParams {
  id: string;
  ordinal: number;
}

export interface ApprovalControllerRefreshInput {
  path: ApprovalControllerRefreshPathParams;
}

export interface ApprovalControllerRefreshResponses {
  200: {
    data: ApprovalRequestDetail;
  };
}

export type ApprovalControllerRefreshResponse = ApprovalControllerRefreshResponses[200];

export type ApprovalControllerRefreshResult = ApiResponse<
  200,
  ApprovalControllerRefreshResponses[200]
>;

export function getApprovalControllerRefreshUrl(path: ApprovalControllerRefreshPathParams): string {
  return buildUrl('/approvals/{id}/steps/{ordinal}/refresh', path);
}
