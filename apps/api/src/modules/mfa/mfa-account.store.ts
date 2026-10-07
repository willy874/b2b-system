import type { JobType } from '@/core/jobs';
import type { MfaAccount, MfaRealm } from '@/core/mfa';

import type { MfaRepository } from './mfa.repository';

/** 框架看得到的帳號狀態（不含密碼雜湊之外的帳號欄位）。 */
export interface MfaStoredAccount {
  account: MfaAccount;
  /** 可以登入：未刪除、`active`。 */
  active: boolean;
  /** 登入失敗鎖定中（`locked_until` 未到期）。 */
  locked: boolean;
  /** 依 active 的因子維護的衍生欄位。 */
  mfaEnabled: boolean;
}

/** 稽核的事件；動作名稱與資源類型由身分範圍決定（租戶 `mfa.*`、`user.mfa.reset`；平台 `platformAdmin.mfa.*`）。 */
export type MfaAuditKind =
  | 'factorAdd'
  | 'factorRemove'
  | 'recoveryRegenerate'
  | 'recoveryUse'
  | 'reset'
  | 'loginFailure';

export interface MfaAuditInput {
  kind: MfaAuditKind;
  /** 被操作的帳號。 */
  target: MfaAccount;
  /** 做這件事的人；自助與登入時就是本人。 */
  actor?: { id: string; email: string };
  result?: 'success' | 'failure';
  errorCode?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 一個身分範圍的帳號與 MFA 儲存（docs/architecture/backend/21-mfa.md §1、D5）：租戶（`users`、租戶 DB）與平台
 * （`platform_admins`、平台 DB）各一個實作。`MfaService` 只認這個介面，方式也只經 `MfaAccountContext` 碰到它。
 * `TTx` 是那個 DB 的交易；`MfaService` 把它當不透明的值傳回來。
 */
export interface MfaAccountStore<TTx = unknown> {
  readonly realm: MfaRealm;
  readonly repo: MfaRepository<TTx>;

  findAccount(accountId: string): Promise<MfaStoredAccount | undefined>;
  /** 敏感的自助動作（移除因子、重新產生備用碼）要再輸入密碼（§7）。 */
  verifyPassword(accountId: string, password: string): Promise<boolean>;

  transaction<T>(fn: (tx: TTx) => Promise<T>): Promise<T>;
  /** 帶 `tx` 時與寫入同一個交易；沒帶時「不能因為稽核失敗而改變回應」（登入失敗之類）。 */
  audit(input: MfaAuditInput, tx?: TTx): Promise<void>;
  /** 在帳號的脈絡入列工作；帶 `tx` 時提交後才真的入列（租戶走 outbox，平台在提交後送出）。 */
  enqueue<TData extends object>(type: JobType<TData>, data: TData, tx?: TTx): Promise<void>;
  /** 結束這個人所有的 session（`token_version + 1`、撤銷 refresh 家族）；提交後發 `SESSIONS_REVOKED`。 */
  revokeSessions(accountId: string, tx: TTx): Promise<void>;
  /** `mfa_enabled` 變了：列表的推播（租戶）。 */
  mfaStatusChanged(accountId: string): Promise<void>;

  // ── 登入的第二步（§4.2）────────────────────────────────

  /** 漸進延遲的計數範圍（租戶 id、`platform`）。 */
  throttleScope(): string;
  /** 第二步的一次失敗：併入帳號的鎖定（已知來源不累計）。 */
  recordLoginFailure(
    stored: MfaStoredAccount,
    ipPrefix: string,
    metadata: Record<string, unknown>,
  ): Promise<void>;
  /** 第二步通過：歸零計數、記住來源、寫成功的稽核。 */
  completeLogin(
    stored: MfaStoredAccount,
    completion: { amr: string[]; mfaMethod?: string },
  ): Promise<void>;
  /** IdP 上的帳號 id（`t:{tenantId}:{userId}`、`p:{adminId}`）。 */
  oidcAccountId(accountId: string): string;
}
