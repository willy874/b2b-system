import type { z } from 'zod';

import type { JobType } from '@/core/jobs';

/**
 * MFA 的驗證方式（docs/architecture/backend/21-mfa.md §2）。每種方式是一個實作 `MfaMethod` 的模組，在 `onModuleInit` 向
 * `MfaMethodRegistry` 登記；登入互動、管理端點、資料表、稽核、限流都只認這個介面（D1）。
 */

/** 身分範圍（docs/architecture/04-sso.md §1.1）：租戶的使用者、平台管理者。 */
export type MfaRealm = 'tenant' | 'platform';
export const MFA_REALMS = ['tenant', 'platform'] as const satisfies readonly MfaRealm[];

/** 驗證的用途：登入的第二步、設定時確認。之後加 `stepUp`（敏感操作的再驗證）。 */
export type MfaPurpose = 'login' | 'enroll';

export interface MfaMethodDefinition {
  /** camelCase，例：`totp`、`email`。上線後不改名：改名等於新方式，既有的因子與覆寫都會失效。 */
  id: string;
  /** 完成互動時寫進 amr（RFC 8176）：TOTP `otp`；Email `email`（非登記值，D12）。 */
  amr: string;
  /** 能用在哪些身分範圍。 */
  realms: readonly MfaRealm[];
  /** 每個帳號最多幾個這種因子：TOTP 5（多支手機）、Email 1（綁帳號 email）。 */
  maxFactorsPerAccount: number;
  /** 驗證前要不要先由伺服器發出 challenge：TOTP `none`；Email `server`（寄信）。 */
  challenge: 'none' | 'server';
  /** 在哪裡設定：`anywhere`；綁 origin 的方式（之後的 WebAuthn）是 `idp`，只能在 apps/platform 設定（D14）。 */
  enrollAt: 'anywhere' | 'idp';
  /** 平台兩級都沒有覆寫時的值（照 feature flag 的 `defaultEnabled`）。 */
  defaultEnabled: boolean;
  /** 安全強度（N2、D16）：`possession`（裝置）｜`inbox`（信箱，與重設密碼同一個管道）。這一版只顯示。 */
  assurance: 'possession' | 'inbox';
}

/** 方式看得到的帳號資訊；不知道自己在哪個 DB（D5）。 */
export interface MfaAccount {
  id: string;
  email: string;
  displayName: string;
  locale: string;
  realm: MfaRealm;
  /** 租戶的使用者才有；驗證器 App 的 issuer 用租戶名稱（§14.0 #6）。 */
  tenant: { id: string; code: string; name: string } | null;
}

export interface MfaFactor {
  id: string;
  accountId: string;
  method: string;
  label: string | null;
  status: 'pending' | 'active';
  /** `SecretBox(MFA_SECRET_KEY)` 的密文；沒有機密的方式是 null。 */
  secretEncrypted: string | null;
  /** 方式自己的非機密設定。 */
  config: Record<string, unknown>;
  /** 最後一次接受的計數（TOTP 的時間步），防重放。 */
  lastUsedCounter: number | null;
  lastUsedAt: Date | null;
  /** 在登入互動中設定的 pending 因子：互動的 uid。 */
  interactionUid: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
}

export interface MfaChallenge {
  id: string;
  factorId: string;
  purpose: MfaPurpose;
  /** 方式自己的狀態（Email：碼的 HMAC、寄出時間）。 */
  state: Record<string, unknown>;
  attempts: number;
  expiresAt: Date;
  /** 這個時間之後才能再發一次。 */
  resendAfter: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

/** 機密的加解密與 HMAC（`MFA_SECRET_KEY`）。 */
export interface MfaSecrets {
  encrypt(plaintext: string): string;
  decrypt(sealed: string): string;
  /** HMAC-SHA256（以 `MFA_SECRET_KEY` 推導的子金鑰），hex。驗證碼只存它：6 位數的純雜湊一秒可窮舉。 */
  hmac(data: string): string;
}

/** 框架建立、傳給方式的脈絡（D5）。 */
export interface MfaAccountContext {
  realm: MfaRealm;
  account: MfaAccount;
  secrets: MfaSecrets;
  /**
   * 在帳號的脈絡入列工作（租戶：在框架的交易內走 outbox；平台：交易提交後送出）。
   * 工作的 `scope` 必須與 `realm` 一致。
   */
  enqueue<TData extends object>(type: JobType<TData>, data: TData): Promise<void>;
}

export interface MfaEnrollmentStart {
  /** 要加密存放的機密（TOTP 的 seed）；框架以 `MfaSecrets.encrypt` 存成 `secret_encrypted`。 */
  secret?: string;
  config?: Record<string, unknown>;
  /** 給前端的資料（TOTP：otpauth URI、手動輸入用的金鑰）。只出現在這個回應，不寫日誌。 */
  publicData: Record<string, unknown>;
}

export interface MfaChallengeStart {
  state: Record<string, unknown>;
  expiresInSeconds: number;
  /** 多久之後才能再發一次（Email 的重寄冷卻）。 */
  resendAfterSeconds: number;
  /** 給前端的提示（Email：遮蔽過的收件地址）。 */
  hint?: string;
}

export type MfaVerifyResult =
  | { ok: true; counter?: number }
  | { ok: false; reason: 'invalid' | 'expired' | 'replayed' };

export interface MfaFactorSummary {
  /** 使用者取的名稱或方式給的預設名稱。 */
  label: string | null;
  /** 不含機密的提示（Email：`w***@example.com`）。 */
  hint: string | null;
}

export interface MfaMethod<TVerify = unknown> {
  readonly definition: MfaMethodDefinition;
  /** verify 的 payload（TOTP：`{ code }`）。框架以它驗證後才呼叫 `verify`。 */
  readonly verifySchema: z.ZodType<TVerify>;

  /** 開始設定：產生機密與要給前端的資料。不寫 DB，由框架存成 pending 的因子。 */
  beginEnrollment(ctx: MfaAccountContext): Promise<MfaEnrollmentStart>;
  /**
   * 發出 challenge（`challenge = 'server'` 的方式才實作）。`challengeId` 由框架先產生：
   * 方式可以把它放進自己入列的工作，challenge 與工作在同一個交易寫入。
   */
  startChallenge?(
    ctx: MfaAccountContext,
    factor: MfaFactor,
    challenge: { id: string; purpose: MfaPurpose },
  ): Promise<MfaChallengeStart>;
  /** 驗證。只回傳結果，不寫 DB、不計數：失敗次數、鎖定、稽核、consumed 都由框架處理（D2）。 */
  verify(
    ctx: MfaAccountContext,
    factor: MfaFactor,
    challenge: MfaChallenge | null,
    payload: TVerify,
  ): Promise<MfaVerifyResult>;
  /** 列表上的顯示。不得含機密。 */
  describe(factor: MfaFactor, account: MfaAccount): MfaFactorSummary;
}

/**
 * 驗證器 App 顯示的 issuer：租戶的使用者是租戶名稱，平台管理者是這個（docs/architecture/backend/21-mfa.md §9.1；
 * 之後由租戶品牌決定產品名稱）。
 */
export const PLATFORM_MFA_ISSUER = 'B2B Platform';

export function mfaIssuerOf(account: MfaAccount): string {
  return account.tenant?.name ?? PLATFORM_MFA_ISSUER;
}

/** 備用碼在 API 上的方式 id：保留字，不能被方式使用（D15）。 */
export const MFA_RECOVERY_METHOD = 'recovery';
