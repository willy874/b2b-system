// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：Game Editor API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  ChangePasswordRequest,
  ForgotPasswordRequest,
  LoginRequest,
  Profile,
  ResetPasswordRequest,
  Session,
  SetupRequest,
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
  ResetPasswordRequestSchema,
  SessionSchema,
  SetupRequestSchema,
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
