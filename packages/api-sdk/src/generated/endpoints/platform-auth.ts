// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：B2B System API 0.0.0（OpenAPI 3.0.0）

import { z } from 'zod';

import type { PlatformProfile, Session, SsoCallbackRequest } from '../models';
import { buildUrl, request } from '../runtime';
import type {
  ApiResponse,
  OperationDefinition,
  OperationSchemas,
  RequestOptions,
} from '../runtime';
import { PlatformProfileSchema, SessionSchema, SsoCallbackRequestSchema } from '../schemas';

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

export const PlatformAuthControllerSsoCallbackSchemas = {
  body: SsoCallbackRequestSchema,
  responses: {
    200: z.object({
      data: SessionSchema,
    }),
  },
} satisfies OperationSchemas;

export function getPlatformAuthControllerSsoCallbackUrl(): string {
  return buildUrl('/platform/auth/sso/callback');
}

const platformAuthControllerSsoCallbackOperation: OperationDefinition = {
  id: 'PlatformAuthController_ssoCallback',
  method: 'POST',
  path: '/platform/auth/sso/callback',
  bodyType: 'json',
  contentType: 'application/json',
  responseTypes: { 200: 'json' },
  schemas: PlatformAuthControllerSsoCallbackSchemas,
};

/** apps/auth 的 BFF：授權碼 ＋ PKCE verifier 換平台管理者的 session */
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

export const PlatformAuthControllerRefreshSchemas = {
  responses: {
    200: z.object({
      data: SessionSchema,
    }),
  },
} satisfies OperationSchemas;

export function getPlatformAuthControllerRefreshUrl(): string {
  return buildUrl('/platform/auth/refresh');
}

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

export interface PlatformAuthControllerLogoutResponses {
  200: undefined;
}

export type PlatformAuthControllerLogoutResponse = PlatformAuthControllerLogoutResponses[200];

export type PlatformAuthControllerLogoutResult = ApiResponse<
  200,
  PlatformAuthControllerLogoutResponses[200]
>;

export const PlatformAuthControllerLogoutSchemas = {} satisfies OperationSchemas;

export function getPlatformAuthControllerLogoutUrl(): string {
  return buildUrl('/platform/auth/logout');
}

const platformAuthControllerLogoutOperation: OperationDefinition = {
  id: 'PlatformAuthController_logout',
  method: 'POST',
  path: '/platform/auth/logout',
  responseTypes: { 200: 'none' },
  schemas: PlatformAuthControllerLogoutSchemas,
};

export function platformAuthControllerLogout(
  options?: RequestOptions,
): Promise<PlatformAuthControllerLogoutResult> {
  return request<PlatformAuthControllerLogoutResult>(
    platformAuthControllerLogoutOperation,
    {},
    options,
  );
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

export const PlatformAuthControllerProfileSchemas = {
  responses: {
    200: z.object({
      data: PlatformProfileSchema,
    }),
  },
} satisfies OperationSchemas;

export function getPlatformAuthControllerProfileUrl(): string {
  return buildUrl('/platform/auth/profile');
}

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
