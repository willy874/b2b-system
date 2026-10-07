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
  PlatformMfaSelfControllerConfirmInput,
  PlatformMfaSelfControllerConfirmResult,
  PlatformMfaSelfControllerOverviewResult,
  PlatformMfaSelfControllerRegenerateRecoveryCodesInput,
  PlatformMfaSelfControllerRegenerateRecoveryCodesResult,
  PlatformMfaSelfControllerRemoveInput,
  PlatformMfaSelfControllerRemoveResult,
  PlatformMfaSelfControllerResendInput,
  PlatformMfaSelfControllerResendResult,
  PlatformMfaSelfControllerStartEnrollmentInput,
  PlatformMfaSelfControllerStartEnrollmentResult,
} from '../../endpoints/platform-auth';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';
import {
  ChangePasswordRequestSchema,
  ConfirmMfaEnrollmentRequestSchema,
  MfaChallengeInfoSchema,
  MfaEnrollmentResultSchema,
  MfaEnrollmentSchema,
  MfaOverviewSchema,
  MfaPasswordConfirmRequestSchema,
  MfaRecoveryCodesSchema,
  PlatformProfileSchema,
  ResetPasswordRequestSchema,
  SessionSchema,
  SetupRequestSchema,
  SsoCallbackRequestSchema,
  StartMfaEnrollmentRequestSchema,
  UpdatePlatformProfileRequestSchema,
} from '../components';

// GET /platform/auth/mfa

export const PlatformMfaSelfControllerOverviewSchemas = {
  responses: {
    200: z.object({
      data: MfaOverviewSchema,
    }),
  },
} satisfies OperationSchemas;

const platformMfaSelfControllerOverviewOperation: OperationDefinition = {
  id: 'PlatformMfaSelfController_overview',
  method: 'GET',
  path: '/platform/auth/mfa',
  responseTypes: { 200: 'json' },
  schemas: PlatformMfaSelfControllerOverviewSchemas,
};

/** 我的驗證方式、剩餘備用碼、可以設定的方式 */
export function platformMfaSelfControllerOverview(
  options?: RequestOptions,
): Promise<PlatformMfaSelfControllerOverviewResult> {
  return request<PlatformMfaSelfControllerOverviewResult>(
    platformMfaSelfControllerOverviewOperation,
    {},
    options,
  );
}

// POST /platform/auth/mfa/factors

export const PlatformMfaSelfControllerStartEnrollmentSchemas = {
  body: StartMfaEnrollmentRequestSchema,
  responses: {
    200: z.object({
      data: MfaEnrollmentSchema,
    }),
  },
} satisfies OperationSchemas;

const platformMfaSelfControllerStartEnrollmentOperation: OperationDefinition = {
  id: 'PlatformMfaSelfController_startEnrollment',
  method: 'POST',
  path: '/platform/auth/mfa/factors',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: PlatformMfaSelfControllerStartEnrollmentSchemas,
};

/** 開始設定一種驗證方式（Email 會同時寄出驗證碼） */
export function platformMfaSelfControllerStartEnrollment(
  input: PlatformMfaSelfControllerStartEnrollmentInput,
  options?: RequestOptions,
): Promise<PlatformMfaSelfControllerStartEnrollmentResult> {
  return request<PlatformMfaSelfControllerStartEnrollmentResult>(
    platformMfaSelfControllerStartEnrollmentOperation,
    input,
    options,
  );
}

// POST /platform/auth/mfa/factors/{id}/challenge

export const PlatformMfaSelfControllerResendSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: MfaChallengeInfoSchema,
    }),
  },
} satisfies OperationSchemas;

const platformMfaSelfControllerResendOperation: OperationDefinition = {
  id: 'PlatformMfaSelfController_resend',
  method: 'POST',
  path: '/platform/auth/mfa/factors/{id}/challenge',
  responseTypes: { 200: 'json' },
  schemas: PlatformMfaSelfControllerResendSchemas,
};

/** 設定中：重寄驗證碼 */
export function platformMfaSelfControllerResend(
  input: PlatformMfaSelfControllerResendInput,
  options?: RequestOptions,
): Promise<PlatformMfaSelfControllerResendResult> {
  return request<PlatformMfaSelfControllerResendResult>(
    platformMfaSelfControllerResendOperation,
    input,
    options,
  );
}

// POST /platform/auth/mfa/factors/{id}/confirm

export const PlatformMfaSelfControllerConfirmSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: ConfirmMfaEnrollmentRequestSchema,
  responses: {
    200: z.object({
      data: MfaEnrollmentResultSchema,
    }),
  },
} satisfies OperationSchemas;

const platformMfaSelfControllerConfirmOperation: OperationDefinition = {
  id: 'PlatformMfaSelfController_confirm',
  method: 'POST',
  path: '/platform/auth/mfa/factors/{id}/confirm',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: PlatformMfaSelfControllerConfirmSchemas,
};

/** 確認設定；第一個因子同時產生備用碼（只出現這一次） */
export function platformMfaSelfControllerConfirm(
  input: PlatformMfaSelfControllerConfirmInput,
  options?: RequestOptions,
): Promise<PlatformMfaSelfControllerConfirmResult> {
  return request<PlatformMfaSelfControllerConfirmResult>(
    platformMfaSelfControllerConfirmOperation,
    input,
    options,
  );
}

// DELETE /platform/auth/mfa/factors/{id}

export const PlatformMfaSelfControllerRemoveSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: MfaPasswordConfirmRequestSchema,
} satisfies OperationSchemas;

const platformMfaSelfControllerRemoveOperation: OperationDefinition = {
  id: 'PlatformMfaSelfController_remove',
  method: 'DELETE',
  path: '/platform/auth/mfa/factors/{id}',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'none' },
  schemas: PlatformMfaSelfControllerRemoveSchemas,
};

/** 移除一個驗證方式（要再輸入密碼）；全部移除時備用碼一起刪 */
export function platformMfaSelfControllerRemove(
  input: PlatformMfaSelfControllerRemoveInput,
  options?: RequestOptions,
): Promise<PlatformMfaSelfControllerRemoveResult> {
  return request<PlatformMfaSelfControllerRemoveResult>(
    platformMfaSelfControllerRemoveOperation,
    input,
    options,
  );
}

// POST /platform/auth/mfa/recovery-codes

export const PlatformMfaSelfControllerRegenerateRecoveryCodesSchemas = {
  body: MfaPasswordConfirmRequestSchema,
  responses: {
    200: z.object({
      data: MfaRecoveryCodesSchema,
    }),
  },
} satisfies OperationSchemas;

const platformMfaSelfControllerRegenerateRecoveryCodesOperation: OperationDefinition = {
  id: 'PlatformMfaSelfController_regenerateRecoveryCodes',
  method: 'POST',
  path: '/platform/auth/mfa/recovery-codes',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: PlatformMfaSelfControllerRegenerateRecoveryCodesSchemas,
};

/** 重新產生備用碼（要再輸入密碼），舊的全部作廢 */
export function platformMfaSelfControllerRegenerateRecoveryCodes(
  input: PlatformMfaSelfControllerRegenerateRecoveryCodesInput,
  options?: RequestOptions,
): Promise<PlatformMfaSelfControllerRegenerateRecoveryCodesResult> {
  return request<PlatformMfaSelfControllerRegenerateRecoveryCodesResult>(
    platformMfaSelfControllerRegenerateRecoveryCodesOperation,
    input,
    options,
  );
}

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
