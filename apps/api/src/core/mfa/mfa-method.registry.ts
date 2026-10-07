import { Injectable } from '@nestjs/common';

import { MFA_RECOVERY_METHOD } from './mfa-method';
import type { MfaMethod, MfaRealm } from './mfa-method';

const METHOD_ID_PATTERN = /^[a-z][a-zA-Z0-9]*$/;

/**
 * 驗證方式的註冊表（docs/architecture/backend/21-mfa.md §2、D1）：方式的模組在 `onModuleInit` 登記，
 * `modules/mfa` 只透過它取用方式，不 import 任何方式的模組。登記錯誤（重複、格式）讓程序啟動失敗。
 */
@Injectable()
export class MfaMethodRegistry {
  private readonly methods = new Map<string, MfaMethod>();

  register(method: MfaMethod): void {
    const { id, realms, maxFactorsPerAccount } = method.definition;
    if (!METHOD_ID_PATTERN.test(id)) {
      throw new Error(`MFA 方式的 id ${id} 必須是 camelCase（例：totp）`);
    }
    if (id === MFA_RECOVERY_METHOD) throw new Error(`MFA 方式的 id 不能是保留字 ${id}`);
    if (this.methods.has(id)) throw new Error(`MFA 方式 ${id} 重複登記`);
    if (realms.length === 0) throw new Error(`MFA 方式 ${id} 至少要能用在一個身分範圍`);
    if (!Number.isInteger(maxFactorsPerAccount) || maxFactorsPerAccount < 1) {
      throw new Error(`MFA 方式 ${id} 的 maxFactorsPerAccount 必須是正整數`);
    }
    this.methods.set(id, method);
  }

  /** 不在註冊表的方式（程式移除後 DB 的殘留）回 undefined，呼叫端當作不存在。 */
  get(id: string): MfaMethod | undefined {
    return this.methods.get(id);
  }

  /** 依登記順序；`realm` 有值時只列能用在那個身分範圍的。 */
  list(realm?: MfaRealm): MfaMethod[] {
    const all = [...this.methods.values()];
    return realm ? all.filter((method) => method.definition.realms.includes(realm)) : all;
  }
}
