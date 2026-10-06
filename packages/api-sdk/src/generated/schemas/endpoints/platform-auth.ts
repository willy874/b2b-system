// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  PlatformAuthControllerChangePasswordInput,
  PlatformAuthControllerChangePasswordResult,
  PlatformAuthControllerLogoutResult,
  PlatformAuthControllerProfileResult,
  PlatformAuthControllerRefreshResult,
  PlatformAuthControllerResetPasswordInput,
  PlatformAuthControllerResetPasswordResult,
  PlatformAuthControllerSetupInput,
  PlatformAuthControllerSetupResult,
  PlatformAuthControllerSsoCallbackInput,
  PlatformAuthControllerSsoCallbackResult,
  PlatformAuthControllerUpdateProfileInput,
  PlatformAuthControllerUpdateProfileResult,
  PlatformAuthControllerVerifySetupResult,
} from '../../endpoints/platform-auth';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';
import {
  ChangePasswordRequestSchema,
  PlatformProfileSchema,
  ResetPasswordRequestSchema,
  SessionSchema,
  SetupRequestSchema,
  SsoCallbackRequestSchema,
  UpdatePlatformProfileRequestSchema,
} from '../components';

// POST /platform/auth/sso/callback

export const PlatformAuthControllerSsoCallbackSchemas = {
  body: SsoCallbackRequestSchema,
  responses: {
    200: z.object({
      data: SessionSchema,
    }),
  },
} satisfies OperationSchemas;

const platformAuthControllerSsoCallbackOperation: OperationDefinition = {
  id: 'PlatformAuthController_ssoCallback',
  method: 'POST',
  path: '/platform/auth/sso/callback',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: PlatformAuthControllerSsoCallbackSchemas,
};

/** apps/platform 的 BFF：授權碼 ＋ PKCE verifier 換平台管理者的 session */
export function platformAuthControllerSsoCallback(
  input: PlatformAuthControllerSsoCallbackInput,
  options?: RequestOptions,
): Promise<PlatformAuthControllerSsoCallbackResult> {
  return request<PlatformAuthControllerSsoCallbackResult>(
    platformAuthControllerSsoCallbackOperation,
    input,
    options,
  );
}

// POST /platform/auth/refresh

export const PlatformAuthControllerRefreshSchemas = {
  responses: {
    200: z.object({
      data: SessionSchema,
    }),
  },
} satisfies OperationSchemas;

const platformAuthControllerRefreshOperation: OperationDefinition = {
  id: 'PlatformAuthController_refresh',
  method: 'POST',
  path: '/platform/auth/refresh',
  responseTypes: { 200: 'json' },
  schemas: PlatformAuthControllerRefreshSchemas,
};

/** 以 refresh token 續期（需 x-refresh-request: 1） */
export function platformAuthControllerRefresh(
  options?: RequestOptions,
): Promise<PlatformAuthControllerRefreshResult> {
  return request<PlatformAuthControllerRefreshResult>(
    platformAuthControllerRefreshOperation,
    {},
    options,
  );
}

// POST /platform/auth/logout

export const PlatformAuthControllerLogoutSchemas = {} satisfies OperationSchemas;

const platformAuthControllerLogoutOperation: OperationDefinition = {
  id: 'PlatformAuthController_logout',
  method: 'POST',
  path: '/platform/auth/logout',
  responseTypes: { 200: 'none' },
  schemas: PlatformAuthControllerLogoutSchemas,
};

/** 平台管理者登出：撤銷 refresh 家族並結束 IdP session。沒有 bearer 時以 refresh cookie 認人（需 x-refresh-request: 1） */
export function platformAuthControllerLogout(
  options?: RequestOptions,
): Promise<PlatformAuthControllerLogoutResult> {
  return request<PlatformAuthControllerLogoutResult>(
    platformAuthControllerLogoutOperation,
    {},
    options,
  );
}

// GET /platform/auth/setup/verify

export const PlatformAuthControllerVerifySetupSchemas = {} satisfies OperationSchemas;

const platformAuthControllerVerifySetupOperation: OperationDefinition = {
  id: 'PlatformAuthController_verifySetup',
  method: 'GET',
  path: '/platform/auth/setup/verify',
  responseTypes: { 200: 'none' },
  schemas: PlatformAuthControllerVerifySetupSchemas,
};

/** 檢查平台管理者的啟用 token（回傳 email 供畫面顯示） */
export function platformAuthControllerVerifySetup(
  options?: RequestOptions,
): Promise<PlatformAuthControllerVerifySetupResult> {
  return request<PlatformAuthControllerVerifySetupResult>(
    platformAuthControllerVerifySetupOperation,
    {},
    options,
  );
}

// POST /platform/auth/setup

export const PlatformAuthControllerSetupSchemas = {
  body: SetupRequestSchema,
} satisfies OperationSchemas;

const platformAuthControllerSetupOperation: OperationDefinition = {
  id: 'PlatformAuthController_setup',
  method: 'POST',
  path: '/platform/auth/setup',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'none' },
  schemas: PlatformAuthControllerSetupSchemas,
};

/** 平台管理者以啟用信設定密碼 */
export function platformAuthControllerSetup(
  input: PlatformAuthControllerSetupInput,
  options?: RequestOptions,
): Promise<PlatformAuthControllerSetupResult> {
  return request<PlatformAuthControllerSetupResult>(
    platformAuthControllerSetupOperation,
    input,
    options,
  );
}

// POST /platform/auth/reset-password

export const PlatformAuthControllerResetPasswordSchemas = {
  body: ResetPasswordRequestSchema,
} satisfies OperationSchemas;

const platformAuthControllerResetPasswordOperation: OperationDefinition = {
  id: 'PlatformAuthController_resetPassword',
  method: 'POST',
  path: '/platform/auth/reset-password',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'none' },
  schemas: PlatformAuthControllerResetPasswordSchemas,
};

/** 平台管理者以重設密碼信設定新密碼（結束所有 session） */
export function platformAuthControllerResetPassword(
  input: PlatformAuthControllerResetPasswordInput,
  options?: RequestOptions,
): Promise<PlatformAuthControllerResetPasswordResult> {
  return request<PlatformAuthControllerResetPasswordResult>(
    platformAuthControllerResetPasswordOperation,
    input,
    options,
  );
}

// GET /platform/auth/profile

export const PlatformAuthControllerProfileSchemas = {
  responses: {
    200: z.object({
      data: PlatformProfileSchema,
    }),
  },
} satisfies OperationSchemas;

const platformAuthControllerProfileOperation: OperationDefinition = {
  id: 'PlatformAuthController_profile',
  method: 'GET',
  path: '/platform/auth/profile',
  responseTypes: { 200: 'json' },
  schemas: PlatformAuthControllerProfileSchemas,
};

/** 平台管理者自己的身分 */
export function platformAuthControllerProfile(
  options?: RequestOptions,
): Promise<PlatformAuthControllerProfileResult> {
  return request<PlatformAuthControllerProfileResult>(
    platformAuthControllerProfileOperation,
    {},
    options,
  );
}

// PATCH /platform/auth/profile

export const PlatformAuthControllerUpdateProfileSchemas = {
  body: UpdatePlatformProfileRequestSchema,
  responses: {
    200: z.object({
      data: PlatformProfileSchema,
    }),
  },
} satisfies OperationSchemas;

const platformAuthControllerUpdateProfileOperation: OperationDefinition = {
  id: 'PlatformAuthController_updateProfile',
  method: 'PATCH',
  path: '/platform/auth/profile',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: PlatformAuthControllerUpdateProfileSchemas,
};

/** 平台管理者改自己的顯示名稱 */
export function platformAuthControllerUpdateProfile(
  input: PlatformAuthControllerUpdateProfileInput,
  options?: RequestOptions,
): Promise<PlatformAuthControllerUpdateProfileResult> {
  return request<PlatformAuthControllerUpdateProfileResult>(
    platformAuthControllerUpdateProfileOperation,
    input,
    options,
  );
}

// POST /platform/auth/change-password

export const PlatformAuthControllerChangePasswordSchemas = {
  body: ChangePasswordRequestSchema,
} satisfies OperationSchemas;

const platformAuthControllerChangePasswordOperation: OperationDefinition = {
  id: 'PlatformAuthController_changePassword',
  method: 'POST',
  path: '/platform/auth/change-password',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'none' },
  schemas: PlatformAuthControllerChangePasswordSchemas,
};

/** 平台管理者以目前的密碼換新密碼（結束所有 session） */
export function platformAuthControllerChangePassword(
  input: PlatformAuthControllerChangePasswordInput,
  options?: RequestOptions,
): Promise<PlatformAuthControllerChangePasswordResult> {
  return request<PlatformAuthControllerChangePasswordResult>(
    platformAuthControllerChangePasswordOperation,
    input,
    options,
  );
}
