// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type {
  AuthControllerChangePasswordInput,
  AuthControllerChangePasswordResult,
  AuthControllerForgotPasswordInput,
  AuthControllerForgotPasswordResult,
  AuthControllerLoginInput,
  AuthControllerLoginResult,
  AuthControllerLogoutResult,
  AuthControllerProfileResult,
  AuthControllerRefreshResult,
  AuthControllerRegisterInput,
  AuthControllerRegisterResult,
  AuthControllerResetPasswordInput,
  AuthControllerResetPasswordResult,
  AuthControllerSetupInput,
  AuthControllerSetupResult,
  AuthControllerSsoCallbackInput,
  AuthControllerSsoCallbackResult,
  AuthControllerUpdateProfileInput,
  AuthControllerUpdateProfileResult,
  AuthControllerVerifySetupResult,
  MfaInteractionControllerChallengeInput,
  MfaInteractionControllerChallengeResult,
  MfaInteractionControllerConfirmEnrollmentInput,
  MfaInteractionControllerConfirmEnrollmentResult,
  MfaInteractionControllerResendEnrollmentInput,
  MfaInteractionControllerResendEnrollmentResult,
  MfaInteractionControllerStartEnrollmentInput,
  MfaInteractionControllerStartEnrollmentResult,
  MfaInteractionControllerVerifyInput,
  MfaInteractionControllerVerifyResult,
  MfaSelfControllerConfirmInput,
  MfaSelfControllerConfirmResult,
  MfaSelfControllerOverviewResult,
  MfaSelfControllerRegenerateRecoveryCodesInput,
  MfaSelfControllerRegenerateRecoveryCodesResult,
  MfaSelfControllerRemoveInput,
  MfaSelfControllerRemoveResult,
  MfaSelfControllerResendInput,
  MfaSelfControllerResendResult,
  MfaSelfControllerStartEnrollmentInput,
  MfaSelfControllerStartEnrollmentResult,
  SsoInteractionControllerAbortInput,
  SsoInteractionControllerAbortResult,
  SsoInteractionControllerCompleteExternalInput,
  SsoInteractionControllerCompleteExternalResult,
  SsoInteractionControllerDetailsInput,
  SsoInteractionControllerDetailsResult,
  SsoInteractionControllerDiscoverInput,
  SsoInteractionControllerDiscoverResult,
  SsoInteractionControllerExternalCallbackResult,
  SsoInteractionControllerLoginInput,
  SsoInteractionControllerLoginResult,
  SsoInteractionControllerStartExternalInput,
  SsoInteractionControllerStartExternalResult,
  SsoInteractionControllerToPageInput,
  SsoInteractionControllerToPageResult,
} from '../../endpoints/auth';
import { request } from '../../runtime';
import type { OperationDefinition, OperationSchemas, RequestOptions } from '../../runtime';
import {
  ChangePasswordRequestSchema,
  ConfirmMfaEnrollmentRequestSchema,
  ForgotPasswordRequestSchema,
  LoginRequestSchema,
  MfaChallengeInfoSchema,
  MfaEnrollmentResultSchema,
  MfaEnrollmentSchema,
  MfaInteractionEnrollmentResultSchema,
  MfaLoginChallengeRequestSchema,
  MfaLoginVerifyRequestSchema,
  MfaOverviewSchema,
  MfaPasswordConfirmRequestSchema,
  MfaRecoveryCodesSchema,
  ProfileSchema,
  RegisterRequestSchema,
  RegisterResultSchema,
  ResetPasswordRequestSchema,
  SessionSchema,
  SetupRequestSchema,
  SsoCallbackRequestSchema,
  SsoDiscoverySchema,
  SsoInteractionSchema,
  SsoLoginResultSchema,
  SsoRedirectSchema,
  StartExternalLoginRequestSchema,
  StartMfaEnrollmentRequestSchema,
  UpdateProfileRequestSchema,
} from '../components';

// POST /oidc-interaction/{uid}/mfa/challenge

export const MfaInteractionControllerChallengeSchemas = {
  path: z.object({
    uid: z.string(),
  }),
  body: MfaLoginChallengeRequestSchema,
  responses: {
    200: z.object({
      data: MfaChallengeInfoSchema,
    }),
  },
} satisfies OperationSchemas;

const mfaInteractionControllerChallengeOperation: OperationDefinition = {
  id: 'MfaInteractionController_challenge',
  method: 'POST',
  path: '/oidc-interaction/{uid}/mfa/challenge',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: MfaInteractionControllerChallengeSchemas,
};

/** 第二步：請伺服器發出驗證碼（Email 之類 challenge = server 的方式） */
export function mfaInteractionControllerChallenge(
  input: MfaInteractionControllerChallengeInput,
  options?: RequestOptions,
): Promise<MfaInteractionControllerChallengeResult> {
  return request<MfaInteractionControllerChallengeResult>(
    mfaInteractionControllerChallengeOperation,
    input,
    options,
  );
}

// POST /oidc-interaction/{uid}/mfa/verify

export const MfaInteractionControllerVerifySchemas = {
  path: z.object({
    uid: z.string(),
  }),
  body: MfaLoginVerifyRequestSchema,
  responses: {
    200: z.object({
      data: SsoRedirectSchema,
    }),
  },
} satisfies OperationSchemas;

const mfaInteractionControllerVerifyOperation: OperationDefinition = {
  id: 'MfaInteractionController_verify',
  method: 'POST',
  path: '/oidc-interaction/{uid}/mfa/verify',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: MfaInteractionControllerVerifySchemas,
};

/** 第二步：驗證碼或備用碼；成功時回傳要頂層跳轉的 resume 網址 */
export function mfaInteractionControllerVerify(
  input: MfaInteractionControllerVerifyInput,
  options?: RequestOptions,
): Promise<MfaInteractionControllerVerifyResult> {
  return request<MfaInteractionControllerVerifyResult>(
    mfaInteractionControllerVerifyOperation,
    input,
    options,
  );
}

// POST /oidc-interaction/{uid}/mfa/enroll

export const MfaInteractionControllerStartEnrollmentSchemas = {
  path: z.object({
    uid: z.string(),
  }),
  body: StartMfaEnrollmentRequestSchema,
  responses: {
    200: z.object({
      data: MfaEnrollmentSchema,
    }),
  },
} satisfies OperationSchemas;

const mfaInteractionControllerStartEnrollmentOperation: OperationDefinition = {
  id: 'MfaInteractionController_startEnrollment',
  method: 'POST',
  path: '/oidc-interaction/{uid}/mfa/enroll',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: MfaInteractionControllerStartEnrollmentSchemas,
};

/** 必須啟用 MFA 而還沒設定：在互動中開始設定一種方式 */
export function mfaInteractionControllerStartEnrollment(
  input: MfaInteractionControllerStartEnrollmentInput,
  options?: RequestOptions,
): Promise<MfaInteractionControllerStartEnrollmentResult> {
  return request<MfaInteractionControllerStartEnrollmentResult>(
    mfaInteractionControllerStartEnrollmentOperation,
    input,
    options,
  );
}

// POST /oidc-interaction/{uid}/mfa/enroll/{factorId}/challenge

export const MfaInteractionControllerResendEnrollmentSchemas = {
  path: z.object({
    uid: z.string(),
    factorId: z.string(),
  }),
  responses: {
    200: z.object({
      data: MfaChallengeInfoSchema,
    }),
  },
} satisfies OperationSchemas;

const mfaInteractionControllerResendEnrollmentOperation: OperationDefinition = {
  id: 'MfaInteractionController_resendEnrollment',
  method: 'POST',
  path: '/oidc-interaction/{uid}/mfa/enroll/{factorId}/challenge',
  responseTypes: { 200: 'json' },
  schemas: MfaInteractionControllerResendEnrollmentSchemas,
};

/** 互動中的設定：重寄驗證碼 */
export function mfaInteractionControllerResendEnrollment(
  input: MfaInteractionControllerResendEnrollmentInput,
  options?: RequestOptions,
): Promise<MfaInteractionControllerResendEnrollmentResult> {
  return request<MfaInteractionControllerResendEnrollmentResult>(
    mfaInteractionControllerResendEnrollmentOperation,
    input,
    options,
  );
}

// POST /oidc-interaction/{uid}/mfa/enroll/{factorId}/confirm

export const MfaInteractionControllerConfirmEnrollmentSchemas = {
  path: z.object({
    uid: z.string(),
    factorId: z.string(),
  }),
  body: ConfirmMfaEnrollmentRequestSchema,
  responses: {
    200: z.object({
      data: MfaInteractionEnrollmentResultSchema,
    }),
  },
} satisfies OperationSchemas;

const mfaInteractionControllerConfirmEnrollmentOperation: OperationDefinition = {
  id: 'MfaInteractionController_confirmEnrollment',
  method: 'POST',
  path: '/oidc-interaction/{uid}/mfa/enroll/{factorId}/confirm',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: MfaInteractionControllerConfirmEnrollmentSchemas,
};

/** 互動中的設定：確認驗證碼；回傳備用碼（只出現這一次）與要頂層跳轉的 resume 網址 */
export function mfaInteractionControllerConfirmEnrollment(
  input: MfaInteractionControllerConfirmEnrollmentInput,
  options?: RequestOptions,
): Promise<MfaInteractionControllerConfirmEnrollmentResult> {
  return request<MfaInteractionControllerConfirmEnrollmentResult>(
    mfaInteractionControllerConfirmEnrollmentOperation,
    input,
    options,
  );
}

// GET /auth/mfa

export const MfaSelfControllerOverviewSchemas = {
  responses: {
    200: z.object({
      data: MfaOverviewSchema,
    }),
  },
} satisfies OperationSchemas;

const mfaSelfControllerOverviewOperation: OperationDefinition = {
  id: 'MfaSelfController_overview',
  method: 'GET',
  path: '/auth/mfa',
  responseTypes: { 200: 'json' },
  schemas: MfaSelfControllerOverviewSchemas,
};

/** 我的驗證方式、剩餘備用碼、可以設定的方式 */
export function mfaSelfControllerOverview(
  options?: RequestOptions,
): Promise<MfaSelfControllerOverviewResult> {
  return request<MfaSelfControllerOverviewResult>(mfaSelfControllerOverviewOperation, {}, options);
}

// POST /auth/mfa/factors

export const MfaSelfControllerStartEnrollmentSchemas = {
  body: StartMfaEnrollmentRequestSchema,
  responses: {
    200: z.object({
      data: MfaEnrollmentSchema,
    }),
  },
} satisfies OperationSchemas;

const mfaSelfControllerStartEnrollmentOperation: OperationDefinition = {
  id: 'MfaSelfController_startEnrollment',
  method: 'POST',
  path: '/auth/mfa/factors',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: MfaSelfControllerStartEnrollmentSchemas,
};

/** 開始設定一種驗證方式（Email 會同時寄出驗證碼） */
export function mfaSelfControllerStartEnrollment(
  input: MfaSelfControllerStartEnrollmentInput,
  options?: RequestOptions,
): Promise<MfaSelfControllerStartEnrollmentResult> {
  return request<MfaSelfControllerStartEnrollmentResult>(
    mfaSelfControllerStartEnrollmentOperation,
    input,
    options,
  );
}

// POST /auth/mfa/factors/{id}/challenge

export const MfaSelfControllerResendSchemas = {
  path: z.object({
    id: z.string(),
  }),
  responses: {
    200: z.object({
      data: MfaChallengeInfoSchema,
    }),
  },
} satisfies OperationSchemas;

const mfaSelfControllerResendOperation: OperationDefinition = {
  id: 'MfaSelfController_resend',
  method: 'POST',
  path: '/auth/mfa/factors/{id}/challenge',
  responseTypes: { 200: 'json' },
  schemas: MfaSelfControllerResendSchemas,
};

/** 設定中：重寄驗證碼 */
export function mfaSelfControllerResend(
  input: MfaSelfControllerResendInput,
  options?: RequestOptions,
): Promise<MfaSelfControllerResendResult> {
  return request<MfaSelfControllerResendResult>(mfaSelfControllerResendOperation, input, options);
}

// POST /auth/mfa/factors/{id}/confirm

export const MfaSelfControllerConfirmSchemas = {
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

const mfaSelfControllerConfirmOperation: OperationDefinition = {
  id: 'MfaSelfController_confirm',
  method: 'POST',
  path: '/auth/mfa/factors/{id}/confirm',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: MfaSelfControllerConfirmSchemas,
};

/** 確認設定；第一個因子同時產生備用碼（只出現這一次） */
export function mfaSelfControllerConfirm(
  input: MfaSelfControllerConfirmInput,
  options?: RequestOptions,
): Promise<MfaSelfControllerConfirmResult> {
  return request<MfaSelfControllerConfirmResult>(mfaSelfControllerConfirmOperation, input, options);
}

// DELETE /auth/mfa/factors/{id}

export const MfaSelfControllerRemoveSchemas = {
  path: z.object({
    id: z.string(),
  }),
  body: MfaPasswordConfirmRequestSchema,
} satisfies OperationSchemas;

const mfaSelfControllerRemoveOperation: OperationDefinition = {
  id: 'MfaSelfController_remove',
  method: 'DELETE',
  path: '/auth/mfa/factors/{id}',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'none' },
  schemas: MfaSelfControllerRemoveSchemas,
};

/** 移除一個驗證方式（要再輸入密碼）；全部移除時備用碼一起刪 */
export function mfaSelfControllerRemove(
  input: MfaSelfControllerRemoveInput,
  options?: RequestOptions,
): Promise<MfaSelfControllerRemoveResult> {
  return request<MfaSelfControllerRemoveResult>(mfaSelfControllerRemoveOperation, input, options);
}

// POST /auth/mfa/recovery-codes

export const MfaSelfControllerRegenerateRecoveryCodesSchemas = {
  body: MfaPasswordConfirmRequestSchema,
  responses: {
    200: z.object({
      data: MfaRecoveryCodesSchema,
    }),
  },
} satisfies OperationSchemas;

const mfaSelfControllerRegenerateRecoveryCodesOperation: OperationDefinition = {
  id: 'MfaSelfController_regenerateRecoveryCodes',
  method: 'POST',
  path: '/auth/mfa/recovery-codes',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: MfaSelfControllerRegenerateRecoveryCodesSchemas,
};

/** 重新產生備用碼（要再輸入密碼），舊的全部作廢 */
export function mfaSelfControllerRegenerateRecoveryCodes(
  input: MfaSelfControllerRegenerateRecoveryCodesInput,
  options?: RequestOptions,
): Promise<MfaSelfControllerRegenerateRecoveryCodesResult> {
  return request<MfaSelfControllerRegenerateRecoveryCodesResult>(
    mfaSelfControllerRegenerateRecoveryCodesOperation,
    input,
    options,
  );
}

// POST /auth/login

export const AuthControllerLoginSchemas = {
  body: LoginRequestSchema,
  responses: {
    200: z.object({
      data: SessionSchema,
    }),
  },
} satisfies OperationSchemas;

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

export const AuthControllerRefreshSchemas = {
  responses: {
    200: z.object({
      data: SessionSchema,
    }),
  },
} satisfies OperationSchemas;

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

export const AuthControllerLogoutSchemas = {} satisfies OperationSchemas;

const authControllerLogoutOperation: OperationDefinition = {
  id: 'AuthController_logout',
  method: 'POST',
  path: '/auth/logout',
  responseTypes: { 200: 'none' },
  schemas: AuthControllerLogoutSchemas,
};

/** 登出：撤銷 refresh 家族並結束 IdP session。沒有 bearer 時以 refresh cookie 認人（需 x-refresh-request: 1） */
export function authControllerLogout(
  options?: RequestOptions,
): Promise<AuthControllerLogoutResult> {
  return request<AuthControllerLogoutResult>(authControllerLogoutOperation, {}, options);
}

// GET /auth/profile

export const AuthControllerProfileSchemas = {
  responses: {
    200: z.object({
      data: ProfileSchema,
    }),
  },
} satisfies OperationSchemas;

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

export const AuthControllerUpdateProfileSchemas = {
  body: UpdateProfileRequestSchema,
  responses: {
    200: z.object({
      data: ProfileSchema,
    }),
  },
} satisfies OperationSchemas;

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

export const AuthControllerChangePasswordSchemas = {
  body: ChangePasswordRequestSchema,
} satisfies OperationSchemas;

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

export const AuthControllerRegisterSchemas = {
  body: RegisterRequestSchema,
  responses: {
    202: z.object({
      data: RegisterResultSchema,
    }),
  },
} satisfies OperationSchemas;

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

export const AuthControllerForgotPasswordSchemas = {
  body: ForgotPasswordRequestSchema,
} satisfies OperationSchemas;

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

export const AuthControllerResetPasswordSchemas = {
  body: ResetPasswordRequestSchema,
} satisfies OperationSchemas;

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

export const AuthControllerSsoCallbackSchemas = {
  body: SsoCallbackRequestSchema,
  responses: {
    200: z.object({
      data: SessionSchema,
    }),
  },
} satisfies OperationSchemas;

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

export const AuthControllerVerifySetupSchemas = {} satisfies OperationSchemas;

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

export const AuthControllerSetupSchemas = {
  body: SetupRequestSchema,
} satisfies OperationSchemas;

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

export const SsoInteractionControllerExternalCallbackSchemas = {} satisfies OperationSchemas;

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

export const SsoInteractionControllerToPageSchemas = {
  path: z.object({
    uid: z.string(),
  }),
} satisfies OperationSchemas;

const ssoInteractionControllerToPageOperation: OperationDefinition = {
  id: 'SsoInteractionController_toPage',
  method: 'GET',
  path: '/oidc-interaction/{uid}',
  responseTypes: { 200: 'none' },
  schemas: SsoInteractionControllerToPageSchemas,
};

/** 轉到 apps/platform 的登入互動頁（互動 cookie 已設在這個路徑） */
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

export const SsoInteractionControllerLoginSchemas = {
  path: z.object({
    uid: z.string(),
  }),
  body: LoginRequestSchema,
  responses: {
    200: z.object({
      data: SsoLoginResultSchema,
    }),
  },
} satisfies OperationSchemas;

const ssoInteractionControllerLoginOperation: OperationDefinition = {
  id: 'SsoInteractionController_login',
  method: 'POST',
  path: '/oidc-interaction/{uid}/login',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: SsoInteractionControllerLoginSchemas,
};

/** 密碼登入；不需要 MFA 時回傳要頂層跳轉的 resume 網址，需要時回傳下一步（next） */
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

export const SsoInteractionControllerCompleteExternalSchemas = {
  path: z.object({
    uid: z.string(),
  }),
} satisfies OperationSchemas;

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
