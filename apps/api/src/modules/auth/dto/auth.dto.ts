import { z } from 'zod';

import { defineSchema } from '@/core/validation';
import { ALL_PLATFORM_PERMISSION_KEYS } from '@/db/seeds/platform-permissions';
import { PermissionKeySchema } from '@/modules/permission/dto/permission.dto';
import { RoleSummarySchema, UserStatusSchema } from '@/modules/user/dto/user.dto';

import { PasswordSchema } from '../password';

export const LoginSchema = defineSchema(
  'LoginRequest',
  z.object({
    email: z.string().trim().email().max(255),
    password: z.string().min(1).max(128),
  }),
);

export const SessionSchema = defineSchema(
  'Session',
  z.object({
    accessToken: z.string(),
    tokenType: z.literal('Bearer'),
    expiresIn: z.number().int(),
  }),
);

export const ProfileSchema = defineSchema(
  'Profile',
  z.object({
    user: z.object({
      id: z.string().uuid(),
      email: z.string(),
      username: z.string().nullable(),
      displayName: z.string(),
      status: UserStatusSchema,
      lastLoginAt: z.string().nullable(),
      preferences: z.object({ locale: z.string(), timezone: z.string() }),
    }),
    roles: z.array(RoleSummarySchema),
    permissions: z.array(PermissionKeySchema),
  }),
);

/** 平台管理者自己的身分（apps/auth，docs/adr/0020-physical-tenant-isolation.md D5）。 */
/**
 * 平台的權限鍵：以 `PlatformPermissionKey` 出現在 OpenAPI，apps/auth 由 api-sdk 取得常數（同租戶的 `PermissionKey`，ADR-0007）。
 */
export const PlatformPermissionKeySchema = defineSchema(
  'PlatformPermissionKey',
  z.enum(ALL_PLATFORM_PERMISSION_KEYS as [string, ...string[]]),
);

export const PlatformProfileSchema = defineSchema(
  'PlatformProfile',
  z.object({
    admin: z.object({
      id: z.string().uuid(),
      email: z.string(),
      displayName: z.string(),
      status: z.enum(['active', 'inactive', 'locked']),
      lastLoginAt: z.string().nullable(),
      role: z.enum(['super-admin', 'operator', 'auditor']),
    }),
    /** 平台的權限鍵（docs/rbac/02-permission-catalog.md §8）。 */
    permissions: z.array(PlatformPermissionKeySchema),
  }),
);

export const UpdateProfileSchema = defineSchema(
  'UpdateProfileRequest',
  z
    .object({
      displayName: z.string().trim().min(1).max(100).optional(),
      preferences: z
        .object({
          locale: z.string().max(10).optional(),
          timezone: z.string().max(64).optional(),
        })
        .optional(),
    })
    .refine((value) => Object.keys(value).length > 0, {
      message: 'at least one field is required',
    }),
);

export const ChangePasswordSchema = defineSchema(
  'ChangePasswordRequest',
  z.object({
    currentPassword: z.string().min(1).max(128),
    newPassword: PasswordSchema,
  }),
);

export const ForgotPasswordSchema = defineSchema(
  'ForgotPasswordRequest',
  z.object({ email: z.string().trim().email().max(255) }),
);

export const ResetPasswordSchema = defineSchema(
  'ResetPasswordRequest',
  z.object({ token: z.string().min(10).max(200), newPassword: PasswordSchema }),
);

export const SetupSchema = defineSchema(
  'SetupRequest',
  z.object({ token: z.string().min(10).max(200), password: PasswordSchema }),
);

export const RegisterSchema = defineSchema(
  'RegisterRequest',
  z.object({
    email: z.string().trim().email().max(255),
    displayName: z.string().trim().min(1).max(100),
    password: PasswordSchema,
    /** 給審核者看的申請理由。 */
    reason: z.string().trim().max(500).optional(),
  }),
);

export const RegisterResultSchema = defineSchema(
  'RegisterResult',
  z.object({ submitted: z.literal(true) }),
);

export const VerifySetupSchema = z.object({ token: z.string().min(10).max(200) });

// ── SSO（docs/adr/0019-sso-identity-platform.md）────────────────────

/** 登入互動頁顯示的資訊。 */
export const SsoInteractionSchema = defineSchema(
  'SsoInteraction',
  z.object({
    uid: z.string(),
    /** `login`：需要登入；`consent`：第三方 client 的同意（這一版沒有）。 */
    prompt: z.string(),
    clientId: z.string(),
    clientName: z.string(),
    loginHint: z.string().nullable(),
    /**
     * 要登入哪個租戶（互動頁顯示它的名稱）；`null` 是平台管理者的登入
     * （docs/adr/0020-physical-tenant-isolation.md D8）。
     */
    tenant: z.object({ code: z.string(), name: z.string() }).nullable(),
  }),
);

/** 互動完成：前端以 **頂層跳轉** 到 `redirectTo`（provider 的 resume 端點），不以 fetch 跟隨。 */
export const SsoRedirectSchema = defineSchema(
  'SsoRedirect',
  z.object({ redirectTo: z.string().url() }),
);

/** 登入互動頁以 email 查詢網域導向（D9）：有連線時顯示「以 X 登入」；`ssoOnly` 時不顯示密碼欄。 */
export const SsoDiscoveryQuerySchema = z.object({ email: z.string().trim().email().max(255) });

export const SsoDiscoverySchema = defineSchema(
  'SsoDiscovery',
  z.object({
    provider: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
    ssoOnly: z.boolean(),
  }),
);

export const StartExternalLoginSchema = defineSchema(
  'StartExternalLoginRequest',
  z.object({ providerId: z.string().uuid() }),
);

/** 外部 IdP 帶回來的參數（OIDC 授權回應）。 */
export const ExternalCallbackQuerySchema = z.object({
  state: z.string().max(200).optional(),
  code: z.string().max(2000).optional(),
  error: z.string().max(200).optional(),
});

export const ExternalCompleteQuerySchema = z.object({ ticket: z.string().min(10).max(200) });

/** 產品的 BFF：授權碼 ＋ PKCE verifier 換 app session（D3）。 */
export const SsoCallbackSchema = defineSchema(
  'SsoCallbackRequest',
  z.object({
    code: z.string().min(10).max(500),
    codeVerifier: z.string().min(43).max(128),
    clientId: z.string().min(1).max(64),
    redirectUri: z.string().url().max(500),
  }),
);

export type LoginDto = z.infer<typeof LoginSchema>;
export type UpdateProfileDto = z.infer<typeof UpdateProfileSchema>;
export type ChangePasswordDto = z.infer<typeof ChangePasswordSchema>;
export type ForgotPasswordDto = z.infer<typeof ForgotPasswordSchema>;
export type ResetPasswordDto = z.infer<typeof ResetPasswordSchema>;
export type SetupDto = z.infer<typeof SetupSchema>;
export type RegisterDto = z.infer<typeof RegisterSchema>;
export type SsoInteractionDto = z.infer<typeof SsoInteractionSchema>;
export type PlatformProfileDto = z.infer<typeof PlatformProfileSchema>;
export type SsoRedirectDto = z.infer<typeof SsoRedirectSchema>;
export type SsoCallbackDto = z.infer<typeof SsoCallbackSchema>;
export type SsoDiscoveryQueryDto = z.infer<typeof SsoDiscoveryQuerySchema>;
export type SsoDiscoveryDto = z.infer<typeof SsoDiscoverySchema>;
export type StartExternalLoginDto = z.infer<typeof StartExternalLoginSchema>;
export type ExternalCallbackQueryDto = z.infer<typeof ExternalCallbackQuerySchema>;
export type ExternalCompleteQueryDto = z.infer<typeof ExternalCompleteQuerySchema>;
export type ProfileDto = z.infer<typeof ProfileSchema>;
export type SessionDto = z.infer<typeof SessionSchema>;
