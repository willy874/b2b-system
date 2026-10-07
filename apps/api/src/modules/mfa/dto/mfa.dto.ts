import { z } from 'zod';

import { MFA_RECOVERY_METHOD } from '@/core/mfa';
import { defineSchema } from '@/core/validation';
import { SsoRedirectSchema } from '@/modules/oidc-provider/sso-redirect.dto';

/**
 * MFA 的 API（docs/architecture/backend/21-mfa.md §4、§7、§8）。方式的 id 在 OpenAPI 上是字串而不是 enum：
 * 方式由註冊表決定，前端遇到不認得的 id 顯示「這個版本不支援」（§11）。
 */

/** 方式自己的 payload（TOTP：`{ code }`）；框架以方式的 `verifySchema` 驗證。 */
const MfaPayloadSchema = z.record(z.string(), z.unknown());

export const MfaMethodInfoSchema = defineSchema(
  'MfaMethodInfo',
  z.object({
    id: z.string(),
    /** `server`：驗證前要先請伺服器發出 challenge（Email 寄信）。 */
    challenge: z.enum(['none', 'server']),
    /** `idp`：只能在 apps/platform 設定（綁 origin 的方式）。 */
    enrollAt: z.enum(['anywhere', 'idp']),
    assurance: z.enum(['possession', 'inbox']),
    maxFactorsPerAccount: z.number().int(),
  }),
);

export const MfaFactorSchema = defineSchema(
  'MfaFactor',
  z.object({
    id: z.string().uuid(),
    method: z.string(),
    label: z.string().nullable(),
    /** 不含機密的提示（Email：`w***@example.com`）。 */
    hint: z.string().nullable(),
    /** 方式已不在伺服器的註冊表（程式移除了）或目前不能用。 */
    available: z.boolean(),
    createdAt: z.string(),
    lastUsedAt: z.string().nullable(),
  }),
);

export const MfaOverviewSchema = defineSchema(
  'MfaOverview',
  z.object({
    factors: z.array(MfaFactorSchema),
    /** 還沒用過的備用碼；沒有任何因子時是 0。 */
    recoveryCodesRemaining: z.number().int(),
    /** 這個帳號現在可以設定的方式（平台開放 ∩ 租戶政策允許），附上已設定的數量。 */
    methods: z.array(MfaMethodInfoSchema.extend({ enrolled: z.number().int() })),
    /** 政策要求這個帳號必須啟用（移除最後一個因子會被拒絕）。 */
    required: z.boolean(),
  }),
);

export const StartMfaEnrollmentSchema = defineSchema(
  'StartMfaEnrollmentRequest',
  z.object({ method: z.string().min(1).max(64) }),
);

export const MfaChallengeInfoSchema = defineSchema(
  'MfaChallengeInfo',
  z.object({
    challengeId: z.string().uuid(),
    hint: z.string().nullable(),
    expiresAt: z.string(),
    /** 這個時間之後才能再發一次（重寄的倒數）。 */
    resendAvailableAt: z.string(),
  }),
);

export const MfaEnrollmentSchema = defineSchema(
  'MfaEnrollment',
  z.object({
    factorId: z.string().uuid(),
    method: z.string(),
    /** 方式給前端的資料（TOTP：`otpauthUri`、`secret`）。只出現在這個回應，不寫日誌。 */
    publicData: z.record(z.string(), z.unknown()),
    /** `challenge = 'server'` 的方式在開始設定時就發出第一個 challenge。 */
    challenge: MfaChallengeInfoSchema.nullable(),
  }),
);

export const ConfirmMfaEnrollmentSchema = defineSchema(
  'ConfirmMfaEnrollmentRequest',
  z.object({
    challengeId: z.string().uuid().optional(),
    payload: MfaPayloadSchema,
    label: z.string().trim().min(1).max(64).optional(),
  }),
);

export const MfaEnrollmentResultSchema = defineSchema(
  'MfaEnrollmentResult',
  z.object({
    factor: MfaFactorSchema,
    /** 第一個因子才會產生；只出現這一次。 */
    recoveryCodes: z.array(z.string()).nullable(),
  }),
);

/** 敏感的自助動作要再輸入密碼（§7）。 */
export const MfaPasswordConfirmSchema = defineSchema(
  'MfaPasswordConfirmRequest',
  z.object({ password: z.string().min(1).max(128) }),
);

export const MfaRecoveryCodesSchema = defineSchema(
  'MfaRecoveryCodes',
  z.object({ recoveryCodes: z.array(z.string()) }),
);

export const MfaAccountStatusSchema = defineSchema(
  'MfaAccountStatus',
  z.object({
    enabled: z.boolean(),
    factors: z.array(MfaFactorSchema),
    recoveryCodesRemaining: z.number().int(),
  }),
);

// ── 登入互動的第二步（§4）────────────────────────────────

export const MfaLoginChallengeSchema = defineSchema(
  'MfaLoginChallengeRequest',
  z.object({ factorId: z.string().uuid() }),
);

export const MfaLoginVerifySchema = defineSchema(
  'MfaLoginVerifyRequest',
  z.object({
    /** 因子的 id，或 `recovery`（備用碼，payload 是 `{ code }`）。 */
    factorId: z.union([z.string().uuid(), z.literal(MFA_RECOVERY_METHOD)]),
    challengeId: z.string().uuid().optional(),
    payload: MfaPayloadSchema,
  }),
);

/** 互動中的首次設定完成：備用碼（只出現這一次）與 resume 網址；頁面先顯示備用碼，確認保存後才跳轉。 */
export const MfaInteractionEnrollmentResultSchema = defineSchema(
  'MfaInteractionEnrollmentResult',
  z.object({
    recoveryCodes: z.array(z.string()),
    redirectTo: z.string().url(),
  }),
);

export const RecoveryCodePayloadSchema = z.object({ code: z.string().trim().min(1).max(32) });

/** 密碼通過、要驗證既有的因子。 */
export const SsoMfaChallengeNextSchema = defineSchema(
  'SsoMfaChallengeNext',
  z.object({
    next: z.literal('mfa'),
    factors: z.array(MfaFactorSchema),
    recoveryAvailable: z.boolean(),
  }),
);

/** 密碼通過、必須啟用而還沒有因子：先設定一個。 */
export const SsoMfaEnrollNextSchema = defineSchema(
  'SsoMfaEnrollNext',
  z.object({
    next: z.literal('mfaEnroll'),
    methods: z.array(MfaMethodInfoSchema),
  }),
);

/**
 * `POST /oidc-interaction/:uid/login` 的回應（§4）：不需要第二步時是 resume 網址；需要時是下一步。
 * api 與 apps/platform 要同一次部署（舊版的互動頁只認 `redirectTo`）。
 */
export const SsoLoginResultSchema = defineSchema(
  'SsoLoginResult',
  z.union([SsoRedirectSchema, SsoMfaChallengeNextSchema, SsoMfaEnrollNextSchema]),
);

export type MfaMethodInfoDto = z.infer<typeof MfaMethodInfoSchema>;
export type MfaFactorDto = z.infer<typeof MfaFactorSchema>;
export type MfaOverviewDto = z.infer<typeof MfaOverviewSchema>;
export type StartMfaEnrollmentDto = z.infer<typeof StartMfaEnrollmentSchema>;
export type MfaChallengeInfoDto = z.infer<typeof MfaChallengeInfoSchema>;
export type MfaEnrollmentDto = z.infer<typeof MfaEnrollmentSchema>;
export type ConfirmMfaEnrollmentDto = z.infer<typeof ConfirmMfaEnrollmentSchema>;
export type MfaEnrollmentResultDto = z.infer<typeof MfaEnrollmentResultSchema>;
export type MfaPasswordConfirmDto = z.infer<typeof MfaPasswordConfirmSchema>;
export type MfaRecoveryCodesDto = z.infer<typeof MfaRecoveryCodesSchema>;
export type MfaAccountStatusDto = z.infer<typeof MfaAccountStatusSchema>;
export type MfaLoginChallengeDto = z.infer<typeof MfaLoginChallengeSchema>;
export type MfaLoginVerifyDto = z.infer<typeof MfaLoginVerifySchema>;
export type SsoMfaChallengeNextDto = z.infer<typeof SsoMfaChallengeNextSchema>;
export type SsoMfaEnrollNextDto = z.infer<typeof SsoMfaEnrollNextSchema>;
