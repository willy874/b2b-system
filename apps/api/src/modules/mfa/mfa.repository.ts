import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { MfaChallenge, MfaFactor, MfaPurpose } from '@/core/mfa';

export interface NewMfaFactor {
  accountId: string;
  method: string;
  label: string | null;
  secretEncrypted: string | null;
  config: Record<string, unknown>;
  interactionUid: string | null;
}

export interface NewMfaChallenge {
  id: string;
  accountId: string;
  factorId: string;
  purpose: MfaPurpose;
  interactionUid: string | null;
  state: Record<string, unknown>;
  expiresAt: Date;
  resendAfter: Date;
}

/**
 * MFA 的儲存（docs/architecture/backend/21-mfa.md §3、D5）：租戶 DB 與平台 DB 各一個實作，欄位相同。
 * `TTx` 是那個 DB 的交易型別；寫入方法帶它時與呼叫端的業務交易同一個。
 */
export interface MfaRepository<TTx> {
  listFactors(accountId: string, tx?: TTx): Promise<MfaFactor[]>;
  findFactor(accountId: string, factorId: string, tx?: TTx): Promise<MfaFactor | undefined>;
  /**
   * active 的因子中 `config ->> configKey = value` 的（通行金鑰登入以憑證 id 找因子，docs/architecture/04-sso.md §3.6），最多 `limit` 筆。
   * `method`、`configKey` 由方式的程式決定（不是使用者輸入），以字面量放進查詢才能用上部分索引。
   */
  findActiveFactorsByConfig(
    method: string,
    configKey: string,
    value: string,
    limit: number,
  ): Promise<MfaFactor[]>;
  insertFactor(values: NewMfaFactor, tx?: TTx): Promise<MfaFactor>;
  /** pending → active；已不是 pending（併發的另一次確認）時回 false。 */
  activateFactor(
    factorId: string,
    values: {
      label: string | null;
      lastUsedCounter: number | null;
      /** 驗證時方式給的更新（WebAuthn 的公鑰、通訊軟體的收件對象）：整份 `config`、新的密文。 */
      config?: Record<string, unknown>;
      secretEncrypted?: string;
    },
    tx?: TTx,
  ): Promise<boolean>;
  /** 記下使用；`counter` 不大於上一次接受的值時不更新、回 false（防重放）。 */
  recordFactorUse(factorId: string, counter: number | null): Promise<boolean>;
  deleteFactor(accountId: string, factorId: string, tx?: TTx): Promise<boolean>;
  deleteFactors(accountId: string, tx?: TTx): Promise<number>;
  deletePendingFactors(accountId: string, tx?: TTx): Promise<void>;
  /** 依 active 的因子重算帳號的 `mfa_enabled`，回傳新值。 */
  syncMfaEnabled(accountId: string, tx?: TTx): Promise<boolean>;
  countActiveFactorsByMethod(): Promise<Map<string, number>>;

  insertChallenge(values: NewMfaChallenge, tx?: TTx): Promise<MfaChallenge>;
  findChallenge(accountId: string, challengeId: string): Promise<MfaChallenge | undefined>;
  latestChallenge(factorId: string): Promise<MfaChallenge | undefined>;
  /** 寄出時寫入碼的 HMAC 之類（方式的工作）；已消耗時回 false。 */
  updateChallengeState(challengeId: string, state: Record<string, unknown>): Promise<boolean>;
  incrementChallengeAttempts(challengeId: string): Promise<number>;
  consumeChallenge(challengeId: string): Promise<boolean>;

  replaceRecoveryCodes(accountId: string, hashes: readonly string[], tx?: TTx): Promise<void>;
  consumeRecoveryCode(accountId: string, codeHash: string): Promise<boolean>;
  countRecoveryCodes(accountId: string): Promise<number>;

  /** 過期的 pending 因子與 challenge，一批最多 `batchSize`（各自）；回傳刪除筆數。 */
  deleteStaleBatch(pendingBefore: Date, challengesBefore: Date, batchSize: number): Promise<number>;
}

/** 識別字（方式 id、config 的鍵）只能是英數字：要以字面量放進 SQL（部分索引的條件與運算式必須是字面量才比對得上）。 */
const IDENTIFIER = /^[a-zA-Z][a-zA-Z0-9]*$/;

/** `'webauthn'` 這樣的 SQL 字面量；不是識別字時拋錯（程式錯誤，不是使用者輸入）。 */
export function identifierLiteral(value: string): SQL {
  if (!IDENTIFIER.test(value)) throw new Error(`不是合法的識別字：${value}`);
  return sql.raw(`'${value}'`);
}
