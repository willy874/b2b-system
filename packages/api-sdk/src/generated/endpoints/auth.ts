// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

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
import { buildUrl, request } from '../runtime';
import type {
  ApiResponse,
  OperationDefinition,
  OperationSchemas,
  RequestOptions,
} from '../runtime';
import {
  ChangePasswordRequestSchema,
  ForgotPasswordRequestSchema,
  LoginRequestSchema,
  ProfileSchema,
  RegisterRequestSchema,
  RegisterResultSchema,
  ResetPasswordRequestSchema,
  SessionSchema,
  SetupRequestSchema,
  SsoCallbackRequestSchema,
  SsoDiscoverySchema,
  SsoInteractionSchema,
  SsoRedirectSchema,
  StartExternalLoginRequestSchema,
  UpdateProfileRequestSchema,
} from '../schemas';

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

export const AuthControllerLoginSchemas = {
  body: LoginRequestSchema,
  responses: {
    200: z.object({
      data: SessionSchema,
    }),
  },
} satisfies OperationSchemas;

export function getAuthControllerLoginUrl(): string {
  return buildUrl('/auth/login');
}

const authControllerLoginOperation: OperationDefinition = {
  id: 'AuthController_login',
  method: 'POST',
  path: '/auth/login',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: AuthControllerLoginSchemas,
};

/** 帳密登入 */
export function authControllerLogin(
  input: AuthControllerLoginInput,
  options?: RequestOptions,
): Promise<AuthControllerLoginResult> {
  return request<AuthControllerLoginResult>(authControllerLoginOperation, input, options);
}

// POST /auth/refresh

export interface AuthControllerRefreshResponses {
  200: {
    data: Session;
  };
}

export type AuthControllerRefreshResponse = AuthControllerRefreshResponses[200];

export type AuthControllerRefreshResult = ApiResponse<200, AuthControllerRefreshResponses[200]>;

export const AuthControllerRefreshSchemas = {
  responses: {
    200: z.object({
      data: SessionSchema,
    }),
  },
} satisfies OperationSchemas;

export function getAuthControllerRefreshUrl(): string {
  return buildUrl('/auth/refresh');
}

const authControllerRefreshOperation: OperationDefinition = {
  id: 'AuthController_refresh',
  method: 'POST',
  path: '/auth/refresh',
  responseTypes: { 200: 'json' },
  schemas: AuthControllerRefreshSchemas,
};

/** 以 refresh token 續期（需 x-refresh-request: 1） */
export function authControllerRefresh(
  options?: RequestOptions,
): Promise<AuthControllerRefreshResult> {
  return request<AuthControllerRefreshResult>(authControllerRefreshOperation, {}, options);
}

// POST /auth/logout

export interface AuthControllerLogoutResponses {
  200: undefined;
}

export type AuthControllerLogoutResponse = AuthControllerLogoutResponses[200];

export type AuthControllerLogoutResult = ApiResponse<200, AuthControllerLogoutResponses[200]>;

export const AuthControllerLogoutSchemas = {} satisfies OperationSchemas;

export function getAuthControllerLogoutUrl(): string {
  return buildUrl('/auth/logout');
}

const authControllerLogoutOperation: OperationDefinition = {
  id: 'AuthController_logout',
  method: 'POST',
  path: '/auth/logout',
  responseTypes: { 200: 'none' },
  schemas: AuthControllerLogoutSchemas,
};

export function authControllerLogout(
  options?: RequestOptions,
): Promise<AuthControllerLogoutResult> {
  return request<AuthControllerLogoutResult>(authControllerLogoutOperation, {}, options);
}

// GET /auth/profile

export interface AuthControllerProfileResponses {
  200: {
    data: Profile;
  };
}

export type AuthControllerProfileResponse = AuthControllerProfileResponses[200];

export type AuthControllerProfileResult = ApiResponse<200, AuthControllerProfileResponses[200]>;

export const AuthControllerProfileSchemas = {
  responses: {
    200: z.object({
      data: ProfileSchema,
    }),
  },
} satisfies OperationSchemas;

export function getAuthControllerProfileUrl(): string {
  return buildUrl('/auth/profile');
}

const authControllerProfileOperation: OperationDefinition = {
  id: 'AuthController_profile',
  method: 'GET',
  path: '/auth/profile',
  responseTypes: { 200: 'json' },
  schemas: AuthControllerProfileSchemas,
};

/** 自己的身分、角色與扁平化權限集合 */
export function authControllerProfile(
  options?: RequestOptions,
): Promise<AuthControllerProfileResult> {
  return request<AuthControllerProfileResult>(authControllerProfileOperation, {}, options);
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

export const AuthControllerUpdateProfileSchemas = {
  body: UpdateProfileRequestSchema,
  responses: {
    200: z.object({
      data: ProfileSchema,
    }),
  },
} satisfies OperationSchemas;

export function getAuthControllerUpdateProfileUrl(): string {
  return buildUrl('/auth/profile');
}

const authControllerUpdateProfileOperation: OperationDefinition = {
  id: 'AuthController_updateProfile',
  method: 'PATCH',
  path: '/auth/profile',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: AuthControllerUpdateProfileSchemas,
};

export function authControllerUpdateProfile(
  input: AuthControllerUpdateProfileInput,
  options?: RequestOptions,
): Promise<AuthControllerUpdateProfileResult> {
  return request<AuthControllerUpdateProfileResult>(
    authControllerUpdateProfileOperation,
    input,
    options,
  );
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

export const AuthControllerChangePasswordSchemas = {
  body: ChangePasswordRequestSchema,
} satisfies OperationSchemas;

export function getAuthControllerChangePasswordUrl(): string {
  return buildUrl('/auth/change-password');
}

const authControllerChangePasswordOperation: OperationDefinition = {
  id: 'AuthController_changePassword',
  method: 'POST',
  path: '/auth/change-password',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'none' },
  schemas: AuthControllerChangePasswordSchemas,
};

export function authControllerChangePassword(
  input: AuthControllerChangePasswordInput,
  options?: RequestOptions,
): Promise<AuthControllerChangePasswordResult> {
  return request<AuthControllerChangePasswordResult>(
    authControllerChangePasswordOperation,
    input,
    options,
  );
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

export const AuthControllerRegisterSchemas = {
  body: RegisterRequestSchema,
  responses: {
    202: z.object({
      data: RegisterResultSchema,
    }),
  },
} satisfies OperationSchemas;

export function getAuthControllerRegisterUrl(): string {
  return buildUrl('/auth/register');
}

const authControllerRegisterOperation: OperationDefinition = {
  id: 'AuthController_register',
  method: 'POST',
  path: '/auth/register',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 202: 'json' },
  schemas: AuthControllerRegisterSchemas,
};

/** 送出註冊申請，待管理員審批（永遠回 202） */
export function authControllerRegister(
  input: AuthControllerRegisterInput,
  options?: RequestOptions,
): Promise<AuthControllerRegisterResult> {
  return request<AuthControllerRegisterResult>(authControllerRegisterOperation, input, options);
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

export const AuthControllerForgotPasswordSchemas = {
  body: ForgotPasswordRequestSchema,
} satisfies OperationSchemas;

export function getAuthControllerForgotPasswordUrl(): string {
  return buildUrl('/auth/forgot-password');
}

const authControllerForgotPasswordOperation: OperationDefinition = {
  id: 'AuthController_forgotPassword',
  method: 'POST',
  path: '/auth/forgot-password',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'none' },
  schemas: AuthControllerForgotPasswordSchemas,
};

/** 請求密碼重設信（永遠回 200） */
export function authControllerForgotPassword(
  input: AuthControllerForgotPasswordInput,
  options?: RequestOptions,
): Promise<AuthControllerForgotPasswordResult> {
  return request<AuthControllerForgotPasswordResult>(
    authControllerForgotPasswordOperation,
    input,
    options,
  );
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

export const AuthControllerResetPasswordSchemas = {
  body: ResetPasswordRequestSchema,
} satisfies OperationSchemas;

export function getAuthControllerResetPasswordUrl(): string {
  return buildUrl('/auth/reset-password');
}

const authControllerResetPasswordOperation: OperationDefinition = {
  id: 'AuthController_resetPassword',
  method: 'POST',
  path: '/auth/reset-password',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'none' },
  schemas: AuthControllerResetPasswordSchemas,
};

export function authControllerResetPassword(
  input: AuthControllerResetPasswordInput,
  options?: RequestOptions,
): Promise<AuthControllerResetPasswordResult> {
  return request<AuthControllerResetPasswordResult>(
    authControllerResetPasswordOperation,
    input,
    options,
  );
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

export const AuthControllerSsoCallbackSchemas = {
  body: SsoCallbackRequestSchema,
  responses: {
    200: z.object({
      data: SessionSchema,
    }),
  },
} satisfies OperationSchemas;

export function getAuthControllerSsoCallbackUrl(): string {
  return buildUrl('/auth/sso/callback');
}

const authControllerSsoCallbackOperation: OperationDefinition = {
  id: 'AuthController_ssoCallback',
  method: 'POST',
  path: '/auth/sso/callback',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: AuthControllerSsoCallbackSchemas,
};

/** 產品的 BFF：授權碼 ＋ PKCE verifier 換 app session（docs/architecture/04-sso.md §12.2 D3） */
export function authControllerSsoCallback(
  input: AuthControllerSsoCallbackInput,
  options?: RequestOptions,
): Promise<AuthControllerSsoCallbackResult> {
  return request<AuthControllerSsoCallbackResult>(
    authControllerSsoCallbackOperation,
    input,
    options,
  );
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

export const AuthControllerVerifySetupSchemas = {} satisfies OperationSchemas;

export function getAuthControllerVerifySetupUrl(): string {
  return buildUrl('/auth/setup/verify');
}

const authControllerVerifySetupOperation: OperationDefinition = {
  id: 'AuthController_verifySetup',
  method: 'GET',
  path: '/auth/setup/verify',
  responseTypes: { 200: 'none' },
  schemas: AuthControllerVerifySetupSchemas,
};

export function authControllerVerifySetup(
  options?: RequestOptions,
): Promise<AuthControllerVerifySetupResult> {
  return request<AuthControllerVerifySetupResult>(authControllerVerifySetupOperation, {}, options);
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

export const AuthControllerSetupSchemas = {
  body: SetupRequestSchema,
} satisfies OperationSchemas;

export function getAuthControllerSetupUrl(): string {
  return buildUrl('/auth/setup');
}

const authControllerSetupOperation: OperationDefinition = {
  id: 'AuthController_setup',
  method: 'POST',
  path: '/auth/setup',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'none' },
  schemas: AuthControllerSetupSchemas,
};

export function authControllerSetup(
  input: AuthControllerSetupInput,
  options?: RequestOptions,
): Promise<AuthControllerSetupResult> {
  return request<AuthControllerSetupResult>(authControllerSetupOperation, input, options);
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

export const SsoInteractionControllerExternalCallbackSchemas = {} satisfies OperationSchemas;

export function getSsoInteractionControllerExternalCallbackUrl(): string {
  return buildUrl('/oidc-interaction/external/callback');
}

const ssoInteractionControllerExternalCallbackOperation: OperationDefinition = {
  id: 'SsoInteractionController_externalCallback',
  method: 'GET',
  path: '/oidc-interaction/external/callback',
  responseTypes: { 200: 'none' },
  schemas: SsoInteractionControllerExternalCallbackSchemas,
};

/** 外部 IdP 的 redirect URI（固定路徑）：驗證後跳到互動路徑底下完成互動 */
export function ssoInteractionControllerExternalCallback(
  options?: RequestOptions,
): Promise<SsoInteractionControllerExternalCallbackResult> {
  return request<SsoInteractionControllerExternalCallbackResult>(
    ssoInteractionControllerExternalCallbackOperation,
    {},
    options,
  );
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

export const SsoInteractionControllerToPageSchemas = {
  path: z.object({
    uid: z.string(),
  }),
} satisfies OperationSchemas;

export function getSsoInteractionControllerToPageUrl(
  path: SsoInteractionControllerToPagePathParams,
): string {
  return buildUrl('/oidc-interaction/{uid}', path);
}

const ssoInteractionControllerToPageOperation: OperationDefinition = {
  id: 'SsoInteractionController_toPage',
  method: 'GET',
  path: '/oidc-interaction/{uid}',
  responseTypes: { 200: 'none' },
  schemas: SsoInteractionControllerToPageSchemas,
};

/** 轉到 apps/auth 的登入互動頁（互動 cookie 已設在這個路徑） */
export function ssoInteractionControllerToPage(
  input: SsoInteractionControllerToPageInput,
  options?: RequestOptions,
): Promise<SsoInteractionControllerToPageResult> {
  return request<SsoInteractionControllerToPageResult>(
    ssoInteractionControllerToPageOperation,
    input,
    options,
  );
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

export const SsoInteractionControllerDetailsSchemas = {
  path: z.object({
    uid: z.string(),
  }),
  responses: {
    200: z.object({
      data: SsoInteractionSchema,
    }),
  },
} satisfies OperationSchemas;

export function getSsoInteractionControllerDetailsUrl(
  path: SsoInteractionControllerDetailsPathParams,
): string {
  return buildUrl('/oidc-interaction/{uid}/details', path);
}

const ssoInteractionControllerDetailsOperation: OperationDefinition = {
  id: 'SsoInteractionController_details',
  method: 'GET',
  path: '/oidc-interaction/{uid}/details',
  responseTypes: { 200: 'json' },
  schemas: SsoInteractionControllerDetailsSchemas,
};

/** 登入互動的資訊（哪個產品要求登入） */
export function ssoInteractionControllerDetails(
  input: SsoInteractionControllerDetailsInput,
  options?: RequestOptions,
): Promise<SsoInteractionControllerDetailsResult> {
  return request<SsoInteractionControllerDetailsResult>(
    ssoInteractionControllerDetailsOperation,
    input,
    options,
  );
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

export const SsoInteractionControllerLoginSchemas = {
  path: z.object({
    uid: z.string(),
  }),
  body: LoginRequestSchema,
  responses: {
    200: z.object({
      data: SsoRedirectSchema,
    }),
  },
} satisfies OperationSchemas;

export function getSsoInteractionControllerLoginUrl(
  path: SsoInteractionControllerLoginPathParams,
): string {
  return buildUrl('/oidc-interaction/{uid}/login', path);
}

const ssoInteractionControllerLoginOperation: OperationDefinition = {
  id: 'SsoInteractionController_login',
  method: 'POST',
  path: '/oidc-interaction/{uid}/login',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: SsoInteractionControllerLoginSchemas,
};

/** 密碼登入；回傳要頂層跳轉的 resume 網址 */
export function ssoInteractionControllerLogin(
  input: SsoInteractionControllerLoginInput,
  options?: RequestOptions,
): Promise<SsoInteractionControllerLoginResult> {
  return request<SsoInteractionControllerLoginResult>(
    ssoInteractionControllerLoginOperation,
    input,
    options,
  );
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

export const SsoInteractionControllerDiscoverSchemas = {
  path: z.object({
    uid: z.string(),
  }),
  responses: {
    200: z.object({
      data: SsoDiscoverySchema,
    }),
  },
} satisfies OperationSchemas;

export function getSsoInteractionControllerDiscoverUrl(
  path: SsoInteractionControllerDiscoverPathParams,
): string {
  return buildUrl('/oidc-interaction/{uid}/discover', path);
}

const ssoInteractionControllerDiscoverOperation: OperationDefinition = {
  id: 'SsoInteractionController_discover',
  method: 'GET',
  path: '/oidc-interaction/{uid}/discover',
  responseTypes: { 200: 'json' },
  schemas: SsoInteractionControllerDiscoverSchemas,
};

/** 以 email 網域查詢外部 IdP 連線（home realm discovery） */
export function ssoInteractionControllerDiscover(
  input: SsoInteractionControllerDiscoverInput,
  options?: RequestOptions,
): Promise<SsoInteractionControllerDiscoverResult> {
  return request<SsoInteractionControllerDiscoverResult>(
    ssoInteractionControllerDiscoverOperation,
    input,
    options,
  );
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

export const SsoInteractionControllerStartExternalSchemas = {
  path: z.object({
    uid: z.string(),
  }),
  body: StartExternalLoginRequestSchema,
  responses: {
    200: z.object({
      data: SsoRedirectSchema,
    }),
  },
} satisfies OperationSchemas;

export function getSsoInteractionControllerStartExternalUrl(
  path: SsoInteractionControllerStartExternalPathParams,
): string {
  return buildUrl('/oidc-interaction/{uid}/external', path);
}

const ssoInteractionControllerStartExternalOperation: OperationDefinition = {
  id: 'SsoInteractionController_startExternal',
  method: 'POST',
  path: '/oidc-interaction/{uid}/external',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: SsoInteractionControllerStartExternalSchemas,
};

/** 以外部 IdP 登入：回傳要頂層跳轉的外部授權網址 */
export function ssoInteractionControllerStartExternal(
  input: SsoInteractionControllerStartExternalInput,
  options?: RequestOptions,
): Promise<SsoInteractionControllerStartExternalResult> {
  return request<SsoInteractionControllerStartExternalResult>(
    ssoInteractionControllerStartExternalOperation,
    input,
    options,
  );
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

export const SsoInteractionControllerCompleteExternalSchemas = {
  path: z.object({
    uid: z.string(),
  }),
} satisfies OperationSchemas;

export function getSsoInteractionControllerCompleteExternalUrl(
  path: SsoInteractionControllerCompleteExternalPathParams,
): string {
  return buildUrl('/oidc-interaction/{uid}/external/complete', path);
}

const ssoInteractionControllerCompleteExternalOperation: OperationDefinition = {
  id: 'SsoInteractionController_completeExternal',
  method: 'GET',
  path: '/oidc-interaction/{uid}/external/complete',
  responseTypes: { 200: 'none' },
  schemas: SsoInteractionControllerCompleteExternalSchemas,
};

/** 外部 IdP 登入的最後一步（帶得到互動 cookie）：完成互動並跳回 provider */
export function ssoInteractionControllerCompleteExternal(
  input: SsoInteractionControllerCompleteExternalInput,
  options?: RequestOptions,
): Promise<SsoInteractionControllerCompleteExternalResult> {
  return request<SsoInteractionControllerCompleteExternalResult>(
    ssoInteractionControllerCompleteExternalOperation,
    input,
    options,
  );
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

export const SsoInteractionControllerAbortSchemas = {
  path: z.object({
    uid: z.string(),
  }),
  responses: {
    200: z.object({
      data: SsoRedirectSchema,
    }),
  },
} satisfies OperationSchemas;

export function getSsoInteractionControllerAbortUrl(
  path: SsoInteractionControllerAbortPathParams,
): string {
  return buildUrl('/oidc-interaction/{uid}/abort', path);
}

const ssoInteractionControllerAbortOperation: OperationDefinition = {
  id: 'SsoInteractionController_abort',
  method: 'POST',
  path: '/oidc-interaction/{uid}/abort',
  responseTypes: { 200: 'json' },
  schemas: SsoInteractionControllerAbortSchemas,
};

/** 取消登入；產品收到 error=access_denied */
export function ssoInteractionControllerAbort(
  input: SsoInteractionControllerAbortInput,
  options?: RequestOptions,
): Promise<SsoInteractionControllerAbortResult> {
  return request<SsoInteractionControllerAbortResult>(
    ssoInteractionControllerAbortOperation,
    input,
    options,
  );
}
