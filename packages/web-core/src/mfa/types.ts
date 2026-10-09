/**
 * MFA 的 API 形狀（docs/architecture/backend/21-mfa.md §4、§7、§8）。web-core 不依賴 api-sdk：
 * 這裡只描述元件用到的欄位，app 的 SDK 型別結構相容，直接傳進來。
 */

/** 安全強度（docs/architecture/backend/21-mfa.md N2、D16），由強到弱。 */
export type MfaAssurance = 'phishingResistant' | 'possession' | 'messaging' | 'inbox';

export interface MfaMethodInfo {
  id: string;
  challenge: 'none' | 'server';
  /** 設定時第一個 challenge 的時機：`onRequest` 的方式（通訊軟體）要使用者先完成綁定再請求。 */
  enrollChallenge: 'immediate' | 'onRequest';
  /** `idp`：只能在 apps/platform 設定（WebAuthn 綁 apps/platform 的網域）。 */
  enrollAt: 'anywhere' | 'idp';
  assurance: MfaAssurance;
  maxFactorsPerAccount: number;
}

export interface MfaFactorView {
  id: string;
  method: string;
  label: string | null;
  hint: string | null;
  available: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface MfaChallengeInfo {
  challengeId: string;
  hint: string | null;
  expiresAt: string;
  resendAvailableAt: string;
  /** 方式給前端的資料（WebAuthn：瀏覽器 API 的 options）。 */
  publicData?: Record<string, unknown> | null;
}

export interface MfaEnrollment {
  factorId: string;
  method: string;
  publicData: Record<string, unknown>;
  challenge: MfaChallengeInfo | null;
}

export interface MfaOverview {
  factors: MfaFactorView[];
  recoveryCodesRemaining: number;
  methods: Array<MfaMethodInfo & { enrolled: number }>;
  required: boolean;
}

export interface MfaAccountStatus {
  enabled: boolean;
  factors: MfaFactorView[];
  recoveryCodesRemaining: number;
}

/** 確認設定或驗證時送出的內容；payload 由方式的元件組成（TOTP：`{ code }`）。 */
export interface MfaSubmission {
  payload: Record<string, unknown>;
  challengeId?: string;
  label?: string;
}

/** 備用碼在 API 上的因子 id（`POST …/mfa/verify` 的 `factorId`）。 */
export const MFA_RECOVERY_FACTOR = 'recovery';
