// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type {
  ChangePasswordRequest,
  ConfirmMfaEnrollmentRequest,
  MfaChallengeInfo,
  MfaEnrollment,
  MfaEnrollmentResult,
  MfaOverview,
  MfaPasswordConfirmRequest,
  MfaRecoveryCodes,
  PlatformProfile,
  ResetPasswordRequest,
  Session,
  SetupRequest,
  SsoCallbackRequest,
  StartMfaEnrollmentRequest,
  UpdatePlatformProfileRequest,
} from '../models';
import type { ApiResponse } from '../runtime';
import { buildUrl } from '../url';

// GET /platform/auth/mfa

export interface PlatformMfaSelfControllerOverviewResponses {
  200: {
    data: MfaOverview;
  };
}

export type PlatformMfaSelfControllerOverviewResponse =
  PlatformMfaSelfControllerOverviewResponses[200];

export type PlatformMfaSelfControllerOverviewResult = ApiResponse<
  200,
  PlatformMfaSelfControllerOverviewResponses[200]
>;

export function getPlatformMfaSelfControllerOverviewUrl(): string {
  return buildUrl('/platform/auth/mfa');
}

// POST /platform/auth/mfa/factors

export type PlatformMfaSelfControllerStartEnrollmentBody = StartMfaEnrollmentRequest;

export interface PlatformMfaSelfControllerStartEnrollmentInput {
  body: PlatformMfaSelfControllerStartEnrollmentBody;
}

export interface PlatformMfaSelfControllerStartEnrollmentResponses {
  200: {
    data: MfaEnrollment;
  };
}

export type PlatformMfaSelfControllerStartEnrollmentResponse =
  PlatformMfaSelfControllerStartEnrollmentResponses[200];

export type PlatformMfaSelfControllerStartEnrollmentResult = ApiResponse<
  200,
  PlatformMfaSelfControllerStartEnrollmentResponses[200]
>;

export function getPlatformMfaSelfControllerStartEnrollmentUrl(): string {
  return buildUrl('/platform/auth/mfa/factors');
}

// POST /platform/auth/mfa/factors/{id}/challenge

export interface PlatformMfaSelfControllerResendPathParams {
  id: string;
}

export interface PlatformMfaSelfControllerResendInput {
  path: PlatformMfaSelfControllerResendPathParams;
}

export interface PlatformMfaSelfControllerResendResponses {
  200: {
    data: MfaChallengeInfo;
  };
}

export type PlatformMfaSelfControllerResendResponse = PlatformMfaSelfControllerResendResponses[200];

export type PlatformMfaSelfControllerResendResult = ApiResponse<
  200,
  PlatformMfaSelfControllerResendResponses[200]
>;

export function getPlatformMfaSelfControllerResendUrl(
  path: PlatformMfaSelfControllerResendPathParams,
): string {
  return buildUrl('/platform/auth/mfa/factors/{id}/challenge', path);
}

// POST /platform/auth/mfa/factors/{id}/confirm

export interface PlatformMfaSelfControllerConfirmPathParams {
  id: string;
}

export type PlatformMfaSelfControllerConfirmBody = ConfirmMfaEnrollmentRequest;

export interface PlatformMfaSelfControllerConfirmInput {
  path: PlatformMfaSelfControllerConfirmPathParams;
  body: PlatformMfaSelfControllerConfirmBody;
}

export interface PlatformMfaSelfControllerConfirmResponses {
  200: {
    data: MfaEnrollmentResult;
  };
}

export type PlatformMfaSelfControllerConfirmResponse =
  PlatformMfaSelfControllerConfirmResponses[200];

export type PlatformMfaSelfControllerConfirmResult = ApiResponse<
  200,
  PlatformMfaSelfControllerConfirmResponses[200]
>;

export function getPlatformMfaSelfControllerConfirmUrl(
  path: PlatformMfaSelfControllerConfirmPathParams,
): string {
  return buildUrl('/platform/auth/mfa/factors/{id}/confirm', path);
}

// DELETE /platform/auth/mfa/factors/{id}

export interface PlatformMfaSelfControllerRemovePathParams {
  id: string;
}

export type PlatformMfaSelfControllerRemoveBody = MfaPasswordConfirmRequest;

export interface PlatformMfaSelfControllerRemoveInput {
  path: PlatformMfaSelfControllerRemovePathParams;
  body: PlatformMfaSelfControllerRemoveBody;
}

export interface PlatformMfaSelfControllerRemoveResponses {
  200: undefined;
}

export type PlatformMfaSelfControllerRemoveResponse = PlatformMfaSelfControllerRemoveResponses[200];

export type PlatformMfaSelfControllerRemoveResult = ApiResponse<
  200,
  PlatformMfaSelfControllerRemoveResponses[200]
>;

export function getPlatformMfaSelfControllerRemoveUrl(
  path: PlatformMfaSelfControllerRemovePathParams,
): string {
  return buildUrl('/platform/auth/mfa/factors/{id}', path);
}

// POST /platform/auth/mfa/recovery-codes

export type PlatformMfaSelfControllerRegenerateRecoveryCodesBody = MfaPasswordConfirmRequest;

export interface PlatformMfaSelfControllerRegenerateRecoveryCodesInput {
  body: PlatformMfaSelfControllerRegenerateRecoveryCodesBody;
}

export interface PlatformMfaSelfControllerRegenerateRecoveryCodesResponses {
  200: {
    data: MfaRecoveryCodes;
  };
}

export type PlatformMfaSelfControllerRegenerateRecoveryCodesResponse =
  PlatformMfaSelfControllerRegenerateRecoveryCodesResponses[200];

export type PlatformMfaSelfControllerRegenerateRecoveryCodesResult = ApiResponse<
  200,
  PlatformMfaSelfControllerRegenerateRecoveryCodesResponses[200]
>;

export function getPlatformMfaSelfControllerRegenerateRecoveryCodesUrl(): string {
  return buildUrl('/platform/auth/mfa/recovery-codes');
}

// POST /platform/auth/sso/callback

export type PlatformAuthControllerSsoCallbackBody = SsoCallbackRequest;

export interface PlatformAuthControllerSsoCallbackInput {
  body: PlatformAuthControllerSsoCallbackBody;
}

export interface PlatformAuthControllerSsoCallbackResponses {
  200: {
    data: Session;
  };
}

export type PlatformAuthControllerSsoCallbackResponse =
  PlatformAuthControllerSsoCallbackResponses[200];

export type PlatformAuthControllerSsoCallbackResult = ApiResponse<
  200,
  PlatformAuthControllerSsoCallbackResponses[200]
>;

export function getPlatformAuthControllerSsoCallbackUrl(): string {
  return buildUrl('/platform/auth/sso/callback');
}

// POST /platform/auth/refresh

export interface PlatformAuthControllerRefreshResponses {
  200: {
    data: Session;
  };
}

export type PlatformAuthControllerRefreshResponse = PlatformAuthControllerRefreshResponses[200];

export type PlatformAuthControllerRefreshResult = ApiResponse<
  200,
  PlatformAuthControllerRefreshResponses[200]
>;

export function getPlatformAuthControllerRefreshUrl(): string {
  return buildUrl('/platform/auth/refresh');
}

// POST /platform/auth/logout

export interface PlatformAuthControllerLogoutResponses {
  200: undefined;
}

export type PlatformAuthControllerLogoutResponse = PlatformAuthControllerLogoutResponses[200];

export type PlatformAuthControllerLogoutResult = ApiResponse<
  200,
  PlatformAuthControllerLogoutResponses[200]
>;

export function getPlatformAuthControllerLogoutUrl(): string {
  return buildUrl('/platform/auth/logout');
}

// GET /platform/auth/setup/verify

export interface PlatformAuthControllerVerifySetupResponses {
  200: undefined;
}

export type PlatformAuthControllerVerifySetupResponse =
  PlatformAuthControllerVerifySetupResponses[200];

export type PlatformAuthControllerVerifySetupResult = ApiResponse<
  200,
  PlatformAuthControllerVerifySetupResponses[200]
>;

export function getPlatformAuthControllerVerifySetupUrl(): string {
  return buildUrl('/platform/auth/setup/verify');
}

// POST /platform/auth/setup

export type PlatformAuthControllerSetupBody = SetupRequest;

export interface PlatformAuthControllerSetupInput {
  body: PlatformAuthControllerSetupBody;
}

export interface PlatformAuthControllerSetupResponses {
  200: undefined;
}

export type PlatformAuthControllerSetupResponse = PlatformAuthControllerSetupResponses[200];

export type PlatformAuthControllerSetupResult = ApiResponse<
  200,
  PlatformAuthControllerSetupResponses[200]
>;

export function getPlatformAuthControllerSetupUrl(): string {
  return buildUrl('/platform/auth/setup');
}

// POST /platform/auth/reset-password

export type PlatformAuthControllerResetPasswordBody = ResetPasswordRequest;

export interface PlatformAuthControllerResetPasswordInput {
  body: PlatformAuthControllerResetPasswordBody;
}

export interface PlatformAuthControllerResetPasswordResponses {
  200: undefined;
}

export type PlatformAuthControllerResetPasswordResponse =
  PlatformAuthControllerResetPasswordResponses[200];

export type PlatformAuthControllerResetPasswordResult = ApiResponse<
  200,
  PlatformAuthControllerResetPasswordResponses[200]
>;

export function getPlatformAuthControllerResetPasswordUrl(): string {
  return buildUrl('/platform/auth/reset-password');
}

// GET /platform/auth/profile

export interface PlatformAuthControllerProfileResponses {
  200: {
    data: PlatformProfile;
  };
}

export type PlatformAuthControllerProfileResponse = PlatformAuthControllerProfileResponses[200];

export type PlatformAuthControllerProfileResult = ApiResponse<
  200,
  PlatformAuthControllerProfileResponses[200]
>;

export function getPlatformAuthControllerProfileUrl(): string {
  return buildUrl('/platform/auth/profile');
}

// PATCH /platform/auth/profile

export type PlatformAuthControllerUpdateProfileBody = UpdatePlatformProfileRequest;

export interface PlatformAuthControllerUpdateProfileInput {
  body: PlatformAuthControllerUpdateProfileBody;
}

export interface PlatformAuthControllerUpdateProfileResponses {
  200: {
    data: PlatformProfile;
  };
}

export type PlatformAuthControllerUpdateProfileResponse =
  PlatformAuthControllerUpdateProfileResponses[200];

export type PlatformAuthControllerUpdateProfileResult = ApiResponse<
  200,
  PlatformAuthControllerUpdateProfileResponses[200]
>;

export function getPlatformAuthControllerUpdateProfileUrl(): string {
  return buildUrl('/platform/auth/profile');
}

// POST /platform/auth/change-password

export type PlatformAuthControllerChangePasswordBody = ChangePasswordRequest;

export interface PlatformAuthControllerChangePasswordInput {
  body: PlatformAuthControllerChangePasswordBody;
}

export interface PlatformAuthControllerChangePasswordResponses {
  200: undefined;
}

export type PlatformAuthControllerChangePasswordResponse =
  PlatformAuthControllerChangePasswordResponses[200];

export type PlatformAuthControllerChangePasswordResult = ApiResponse<
  200,
  PlatformAuthControllerChangePasswordResponses[200]
>;

export function getPlatformAuthControllerChangePasswordUrl(): string {
  return buildUrl('/platform/auth/change-password');
}
