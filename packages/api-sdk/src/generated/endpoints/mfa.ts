// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type { MfaPolicy, MfaPolicyImpact, UpdateMfaPolicyRequest } from '../models';
import type { ApiResponse } from '../runtime';
import { buildUrl } from '../url';

// GET /mfa/policy

export interface MfaPolicyControllerGetResponses {
  200: {
    data: MfaPolicy;
  };
}

export type MfaPolicyControllerGetResponse = MfaPolicyControllerGetResponses[200];

export type MfaPolicyControllerGetResult = ApiResponse<200, MfaPolicyControllerGetResponses[200]>;

export function getMfaPolicyControllerGetUrl(): string {
  return buildUrl('/mfa/policy');
}

// PUT /mfa/policy

export type MfaPolicyControllerUpdateBody = UpdateMfaPolicyRequest;

export interface MfaPolicyControllerUpdateInput {
  body: MfaPolicyControllerUpdateBody;
}

export interface MfaPolicyControllerUpdateResponses {
  200: {
    data: MfaPolicy;
  };
}

export type MfaPolicyControllerUpdateResponse = MfaPolicyControllerUpdateResponses[200];

export type MfaPolicyControllerUpdateResult = ApiResponse<
  200,
  MfaPolicyControllerUpdateResponses[200]
>;

export function getMfaPolicyControllerUpdateUrl(): string {
  return buildUrl('/mfa/policy');
}

// POST /mfa/policy/preview

export type MfaPolicyControllerPreviewBody = UpdateMfaPolicyRequest;

export interface MfaPolicyControllerPreviewInput {
  body: MfaPolicyControllerPreviewBody;
}

export interface MfaPolicyControllerPreviewResponses {
  200: {
    data: MfaPolicyImpact;
  };
}

export type MfaPolicyControllerPreviewResponse = MfaPolicyControllerPreviewResponses[200];

export type MfaPolicyControllerPreviewResult = ApiResponse<
  200,
  MfaPolicyControllerPreviewResponses[200]
>;

export function getMfaPolicyControllerPreviewUrl(): string {
  return buildUrl('/mfa/policy/preview');
}
