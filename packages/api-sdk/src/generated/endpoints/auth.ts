// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import type {
  ChangePasswordRequest,
  ForgotPasswordRequest,
  LoginRequest,
  Profile,
  RegisterRequest,
  RegisterResult,
  ResetPasswordRequest,
  Session,
  SetupRequest,
  SsoCallbackRequest,
  SsoDiscovery,
  SsoInteraction,
  SsoRedirect,
  StartExternalLoginRequest,
  UpdateProfileRequest,
} from '../models';
import type { ApiResponse } from '../runtime';
import { buildUrl } from '../url';

// POST /auth/login

export type AuthControllerLoginBody = LoginRequest;

export interface AuthControllerLoginInput {
  body: AuthControllerLoginBody;
}

export interface AuthControllerLoginResponses {
  200: {
    data: Session;
  };
}

export type AuthControllerLoginResponse = AuthControllerLoginResponses[200];

export type AuthControllerLoginResult = ApiResponse<200, AuthControllerLoginResponses[200]>;

export function getAuthControllerLoginUrl(): string {
  return buildUrl('/auth/login');
}

// POST /auth/refresh

export interface AuthControllerRefreshResponses {
  200: {
    data: Session;
  };
}

export type AuthControllerRefreshResponse = AuthControllerRefreshResponses[200];

export type AuthControllerRefreshResult = ApiResponse<200, AuthControllerRefreshResponses[200]>;

export function getAuthControllerRefreshUrl(): string {
  return buildUrl('/auth/refresh');
}

// POST /auth/logout

export interface AuthControllerLogoutResponses {
  200: undefined;
}

export type AuthControllerLogoutResponse = AuthControllerLogoutResponses[200];

export type AuthControllerLogoutResult = ApiResponse<200, AuthControllerLogoutResponses[200]>;

export function getAuthControllerLogoutUrl(): string {
  return buildUrl('/auth/logout');
}

// GET /auth/profile

export interface AuthControllerProfileResponses {
  200: {
    data: Profile;
  };
}

export type AuthControllerProfileResponse = AuthControllerProfileResponses[200];

export type AuthControllerProfileResult = ApiResponse<200, AuthControllerProfileResponses[200]>;

export function getAuthControllerProfileUrl(): string {
  return buildUrl('/auth/profile');
}

// PATCH /auth/profile

export type AuthControllerUpdateProfileBody = UpdateProfileRequest;

export interface AuthControllerUpdateProfileInput {
  body: AuthControllerUpdateProfileBody;
}

export interface AuthControllerUpdateProfileResponses {
  200: {
    data: Profile;
  };
}

export type AuthControllerUpdateProfileResponse = AuthControllerUpdateProfileResponses[200];

export type AuthControllerUpdateProfileResult = ApiResponse<
  200,
  AuthControllerUpdateProfileResponses[200]
>;

export function getAuthControllerUpdateProfileUrl(): string {
  return buildUrl('/auth/profile');
}

// POST /auth/change-password

export type AuthControllerChangePasswordBody = ChangePasswordRequest;

export interface AuthControllerChangePasswordInput {
  body: AuthControllerChangePasswordBody;
}

export interface AuthControllerChangePasswordResponses {
  200: undefined;
}

export type AuthControllerChangePasswordResponse = AuthControllerChangePasswordResponses[200];

export type AuthControllerChangePasswordResult = ApiResponse<
  200,
  AuthControllerChangePasswordResponses[200]
>;

export function getAuthControllerChangePasswordUrl(): string {
  return buildUrl('/auth/change-password');
}

// POST /auth/register

export type AuthControllerRegisterBody = RegisterRequest;

export interface AuthControllerRegisterInput {
  body: AuthControllerRegisterBody;
}

export interface AuthControllerRegisterResponses {
  202: {
    data: RegisterResult;
  };
}

export type AuthControllerRegisterResponse = AuthControllerRegisterResponses[202];

export type AuthControllerRegisterResult = ApiResponse<202, AuthControllerRegisterResponses[202]>;

export function getAuthControllerRegisterUrl(): string {
  return buildUrl('/auth/register');
}

// POST /auth/forgot-password

export type AuthControllerForgotPasswordBody = ForgotPasswordRequest;

export interface AuthControllerForgotPasswordInput {
  body: AuthControllerForgotPasswordBody;
}

export interface AuthControllerForgotPasswordResponses {
  200: undefined;
}

export type AuthControllerForgotPasswordResponse = AuthControllerForgotPasswordResponses[200];

export type AuthControllerForgotPasswordResult = ApiResponse<
  200,
  AuthControllerForgotPasswordResponses[200]
>;

export function getAuthControllerForgotPasswordUrl(): string {
  return buildUrl('/auth/forgot-password');
}

// POST /auth/reset-password

export type AuthControllerResetPasswordBody = ResetPasswordRequest;

export interface AuthControllerResetPasswordInput {
  body: AuthControllerResetPasswordBody;
}

export interface AuthControllerResetPasswordResponses {
  200: undefined;
}

export type AuthControllerResetPasswordResponse = AuthControllerResetPasswordResponses[200];

export type AuthControllerResetPasswordResult = ApiResponse<
  200,
  AuthControllerResetPasswordResponses[200]
>;

export function getAuthControllerResetPasswordUrl(): string {
  return buildUrl('/auth/reset-password');
}

// POST /auth/sso/callback

export type AuthControllerSsoCallbackBody = SsoCallbackRequest;

export interface AuthControllerSsoCallbackInput {
  body: AuthControllerSsoCallbackBody;
}

export interface AuthControllerSsoCallbackResponses {
  200: {
    data: Session;
  };
}

export type AuthControllerSsoCallbackResponse = AuthControllerSsoCallbackResponses[200];

export type AuthControllerSsoCallbackResult = ApiResponse<
  200,
  AuthControllerSsoCallbackResponses[200]
>;

export function getAuthControllerSsoCallbackUrl(): string {
  return buildUrl('/auth/sso/callback');
}

// GET /auth/setup/verify

export interface AuthControllerVerifySetupResponses {
  200: undefined;
}

export type AuthControllerVerifySetupResponse = AuthControllerVerifySetupResponses[200];

export type AuthControllerVerifySetupResult = ApiResponse<
  200,
  AuthControllerVerifySetupResponses[200]
>;

export function getAuthControllerVerifySetupUrl(): string {
  return buildUrl('/auth/setup/verify');
}

// POST /auth/setup

export type AuthControllerSetupBody = SetupRequest;

export interface AuthControllerSetupInput {
  body: AuthControllerSetupBody;
}

export interface AuthControllerSetupResponses {
  200: undefined;
}

export type AuthControllerSetupResponse = AuthControllerSetupResponses[200];

export type AuthControllerSetupResult = ApiResponse<200, AuthControllerSetupResponses[200]>;

export function getAuthControllerSetupUrl(): string {
  return buildUrl('/auth/setup');
}

// GET /oidc-interaction/external/callback

export interface SsoInteractionControllerExternalCallbackResponses {
  200: undefined;
}

export type SsoInteractionControllerExternalCallbackResponse =
  SsoInteractionControllerExternalCallbackResponses[200];

export type SsoInteractionControllerExternalCallbackResult = ApiResponse<
  200,
  SsoInteractionControllerExternalCallbackResponses[200]
>;

export function getSsoInteractionControllerExternalCallbackUrl(): string {
  return buildUrl('/oidc-interaction/external/callback');
}

// GET /oidc-interaction/{uid}

export interface SsoInteractionControllerToPagePathParams {
  uid: string;
}

export interface SsoInteractionControllerToPageInput {
  path: SsoInteractionControllerToPagePathParams;
}

export interface SsoInteractionControllerToPageResponses {
  200: undefined;
}

export type SsoInteractionControllerToPageResponse = SsoInteractionControllerToPageResponses[200];

export type SsoInteractionControllerToPageResult = ApiResponse<
  200,
  SsoInteractionControllerToPageResponses[200]
>;

export function getSsoInteractionControllerToPageUrl(
  path: SsoInteractionControllerToPagePathParams,
): string {
  return buildUrl('/oidc-interaction/{uid}', path);
}

// GET /oidc-interaction/{uid}/details

export interface SsoInteractionControllerDetailsPathParams {
  uid: string;
}

export interface SsoInteractionControllerDetailsInput {
  path: SsoInteractionControllerDetailsPathParams;
}

export interface SsoInteractionControllerDetailsResponses {
  200: {
    data: SsoInteraction;
  };
}

export type SsoInteractionControllerDetailsResponse = SsoInteractionControllerDetailsResponses[200];

export type SsoInteractionControllerDetailsResult = ApiResponse<
  200,
  SsoInteractionControllerDetailsResponses[200]
>;

export function getSsoInteractionControllerDetailsUrl(
  path: SsoInteractionControllerDetailsPathParams,
): string {
  return buildUrl('/oidc-interaction/{uid}/details', path);
}

// POST /oidc-interaction/{uid}/login

export interface SsoInteractionControllerLoginPathParams {
  uid: string;
}

export type SsoInteractionControllerLoginBody = LoginRequest;

export interface SsoInteractionControllerLoginInput {
  path: SsoInteractionControllerLoginPathParams;
  body: SsoInteractionControllerLoginBody;
}

export interface SsoInteractionControllerLoginResponses {
  200: {
    data: SsoRedirect;
  };
}

export type SsoInteractionControllerLoginResponse = SsoInteractionControllerLoginResponses[200];

export type SsoInteractionControllerLoginResult = ApiResponse<
  200,
  SsoInteractionControllerLoginResponses[200]
>;

export function getSsoInteractionControllerLoginUrl(
  path: SsoInteractionControllerLoginPathParams,
): string {
  return buildUrl('/oidc-interaction/{uid}/login', path);
}

// GET /oidc-interaction/{uid}/discover

export interface SsoInteractionControllerDiscoverPathParams {
  uid: string;
}

export interface SsoInteractionControllerDiscoverInput {
  path: SsoInteractionControllerDiscoverPathParams;
}

export interface SsoInteractionControllerDiscoverResponses {
  200: {
    data: SsoDiscovery;
  };
}

export type SsoInteractionControllerDiscoverResponse =
  SsoInteractionControllerDiscoverResponses[200];

export type SsoInteractionControllerDiscoverResult = ApiResponse<
  200,
  SsoInteractionControllerDiscoverResponses[200]
>;

export function getSsoInteractionControllerDiscoverUrl(
  path: SsoInteractionControllerDiscoverPathParams,
): string {
  return buildUrl('/oidc-interaction/{uid}/discover', path);
}

// POST /oidc-interaction/{uid}/external

export interface SsoInteractionControllerStartExternalPathParams {
  uid: string;
}

export type SsoInteractionControllerStartExternalBody = StartExternalLoginRequest;

export interface SsoInteractionControllerStartExternalInput {
  path: SsoInteractionControllerStartExternalPathParams;
  body: SsoInteractionControllerStartExternalBody;
}

export interface SsoInteractionControllerStartExternalResponses {
  200: {
    data: SsoRedirect;
  };
}

export type SsoInteractionControllerStartExternalResponse =
  SsoInteractionControllerStartExternalResponses[200];

export type SsoInteractionControllerStartExternalResult = ApiResponse<
  200,
  SsoInteractionControllerStartExternalResponses[200]
>;

export function getSsoInteractionControllerStartExternalUrl(
  path: SsoInteractionControllerStartExternalPathParams,
): string {
  return buildUrl('/oidc-interaction/{uid}/external', path);
}

// GET /oidc-interaction/{uid}/external/complete

export interface SsoInteractionControllerCompleteExternalPathParams {
  uid: string;
}

export interface SsoInteractionControllerCompleteExternalInput {
  path: SsoInteractionControllerCompleteExternalPathParams;
}

export interface SsoInteractionControllerCompleteExternalResponses {
  200: undefined;
}

export type SsoInteractionControllerCompleteExternalResponse =
  SsoInteractionControllerCompleteExternalResponses[200];

export type SsoInteractionControllerCompleteExternalResult = ApiResponse<
  200,
  SsoInteractionControllerCompleteExternalResponses[200]
>;

export function getSsoInteractionControllerCompleteExternalUrl(
  path: SsoInteractionControllerCompleteExternalPathParams,
): string {
  return buildUrl('/oidc-interaction/{uid}/external/complete', path);
}

// POST /oidc-interaction/{uid}/abort

export interface SsoInteractionControllerAbortPathParams {
  uid: string;
}

export interface SsoInteractionControllerAbortInput {
  path: SsoInteractionControllerAbortPathParams;
}

export interface SsoInteractionControllerAbortResponses {
  200: {
    data: SsoRedirect;
  };
}

export type SsoInteractionControllerAbortResponse = SsoInteractionControllerAbortResponses[200];

export type SsoInteractionControllerAbortResult = ApiResponse<
  200,
  SsoInteractionControllerAbortResponses[200]
>;

export function getSsoInteractionControllerAbortUrl(
  path: SsoInteractionControllerAbortPathParams,
): string {
  return buildUrl('/oidc-interaction/{uid}/abort', path);
}
