import { z } from 'zod';

import { TimeZoneSchema } from '@/core/settings';
import { defineSchema } from '@/core/validation';
import { ALL_PLATFORM_PERMISSION_KEYS } from '@/db/seeds/platform-permissions';
import { PasswordSchema } from '@/modules/credential/password';
import { PermissionKeySchema } from '@/modules/permission/dto/permission.dto';
import { TenantFeatureSchema } from '@/modules/tenant/dto/platform-tenant.dto';
import { RoleSummarySchema, UserStatusSchema } from '@/modules/user/dto/user.dto';

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
    /**
     * 目前租戶啟用的 feature（docs/architecture/frontend/02-plugin-system.md §9.2 D8）：前端與權限一起水合，
     * 據此安裝或移除可啟用的 feature。平台管理者變更時推 `resource.changed`（`tenantFeature`）。
     */
    features: z.array(TenantFeatureSchema),
    /**
     * 目前生效為開的 feature flag（docs/architecture/05-tenancy.md §11.2 D6），依目錄的順序。與 `features` 一起水合，
     * 平台管理者變更租戶層或全平台層時同樣推 `resource.changed`（`tenantFeature`）。
     */
    flags: z.array(z.string()),
  }),
);

/** 平台管理者自己的身分（apps/platform，docs/architecture/05-tenancy.md §10.2 D5）。 */
/**
 * 平台的權限鍵：以 `PlatformPermissionKey` 出現在 OpenAPI，apps/platform 由 api-sdk 取得常數（同租戶的 `PermissionKey`，docs/architecture/backend/03-api-conventions.md §12）。
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
      status: z.enum(['active', 'inactive', 'locked', 'pending']),
      lastLoginAt: z.string().nullable(),
      role: z.enum(['super-admin', 'operator', 'auditor']),
    }),
    /** 平台的權限鍵（docs/architecture/iam/02-permission-catalog.md §8）。 */
    permissions: z.array(PlatformPermissionKeySchema),
  }),
);

/** 平台管理者改自己的資料：只有顯示名稱（偏好只存在瀏覽器，沒有 `preferences`）。 */
export const UpdatePlatformProfileSchema = defineSchema(
  'UpdatePlatformProfileRequest',
  z.object({ displayName: z.string().trim().min(1).max(100) }),
);

export const UpdateProfileSchema = defineSchema(
  'UpdateProfileRequest',
  z
    .object({
      displayName: z.string().trim().min(1).max(100).optional(),
      preferences: z
        .object({
          locale: z.string().max(10).optional(),
          timezone: TimeZoneSchema.optional(),
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
    // 不收密碼：核准後由寄到這個 email 的啟用信設定，申請時的密碼從來沒有被驗證過擁有者
    // （舊的用戶端仍送 `password` 時，z.object 預設會丟掉不認得的欄位）
    /** 給審核者看的申請理由。 */
    reason: z.string().trim().max(500).optional(),
  }),
);

export const RegisterResultSchema = defineSchema(
  'RegisterResult',
  z.object({ submitted: z.literal(true) }),
);

export const VerifySetupSchema = z.object({ token: z.string().min(10).max(200) });

// ── SSO（docs/architecture/04-sso.md §12）────────────────────

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
     * 產品要求的介面語系（OIDC 的 `ui_locales`，空白分隔的 BCP 47 標籤）：互動頁以它切換語系，
     * 從 backstage 被導來登入時與 backstage 用同一個語言（docs/architecture/04-sso.md §12）。沒帶時是 `null`。
     */
    uiLocales: z.string().nullable(),
    /**
     * 要登入哪個租戶（互動頁顯示它的名稱）；`null` 是平台管理者的登入
     * （docs/architecture/05-tenancy.md §10.2 D8）。
     */
    tenant: z.object({ code: z.string(), name: z.string() }).nullable(),
    /**
     * 產品要求登入後新增的驗證方式（backstage 的「新增通行金鑰」，docs/architecture/backend/21-mfa.md §7.1）；
     * 互動頁據此顯示「先驗證身分」的說明。沒有是 `null`。
     */
    mfaEnroll: z.string().nullable(),
    /**
     * 可以以通行金鑰取代密碼登入（docs/architecture/04-sso.md §3.6）：平台開放、這個租戶的政策允許 WebAuthn，
     * 而且不是產品要求新增驗證方式的登入（那時要先以密碼重新驗證）。
     */
    passkeyLogin: z.boolean(),
  }),
);

/** 通行金鑰登入的 challenge：給瀏覽器 API 的 options（`@simplewebauthn/browser` 的 `startAuthentication`）。 */
export const SsoPasskeyOptionsSchema = defineSchema(
  'SsoPasskeyOptions',
  z.object({ publicData: z.record(z.string(), z.unknown()) }),
);

/** 通行金鑰登入：瀏覽器 API 的回應（細節由方式驗證）。 */
export const SsoPasskeyLoginSchema = defineSchema(
  'SsoPasskeyLoginRequest',
  z.object({ payload: z.record(z.string(), z.unknown()) }),
);

/** 互動完成：前端以 **頂層跳轉** 到 `redirectTo`（provider 的 resume 端點），不以 fetch 跟隨。 */
export { SsoRedirectSchema } from '@/modules/oidc-provider/sso-redirect.dto';

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

/** SAML 的 ACS 收到的表單（HTTP-POST binding）；上限是寬鬆的（簽章與憑證會讓回應到數十 KB）。 */
export const SamlAcsFormSchema = z.object({
  SAMLResponse: z.string().min(1).max(500_000),
  RelayState: z.string().min(1).max(200),
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
export type SsoPasskeyOptionsDto = z.infer<typeof SsoPasskeyOptionsSchema>;
export type SsoPasskeyLoginDto = z.infer<typeof SsoPasskeyLoginSchema>;
export type PlatformProfileDto = z.infer<typeof PlatformProfileSchema>;
export type UpdatePlatformProfileDto = z.infer<typeof UpdatePlatformProfileSchema>;
export type { SsoRedirectDto } from '@/modules/oidc-provider/sso-redirect.dto';
export type SsoCallbackDto = z.infer<typeof SsoCallbackSchema>;
export type SsoDiscoveryQueryDto = z.infer<typeof SsoDiscoveryQuerySchema>;
export type SsoDiscoveryDto = z.infer<typeof SsoDiscoverySchema>;
export type StartExternalLoginDto = z.infer<typeof StartExternalLoginSchema>;
export type ExternalCallbackQueryDto = z.infer<typeof ExternalCallbackQuerySchema>;
export type ExternalCompleteQueryDto = z.infer<typeof ExternalCompleteQuerySchema>;
export type ProfileDto = z.infer<typeof ProfileSchema>;
export type SessionDto = z.infer<typeof SessionSchema>;
