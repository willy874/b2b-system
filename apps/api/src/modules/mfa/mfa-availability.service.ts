import { Injectable } from '@nestjs/common';

import { MfaMethodRegistry } from '@/core/mfa';
import type { MfaFactor, MfaMethod, MfaRealm } from '@/core/mfa';

import type { MfaAccountStore, MfaStoredAccount } from './mfa-account.store';

/** 平台管理者可用的方式（M3 之前寫死，之後由 `PLATFORM_MFA_METHODS` 決定；D10）。 */
const PLATFORM_METHODS: readonly string[] = ['totp'];

/**
 * 「誰能用哪些方式、誰必須啟用」（docs/architecture/backend/21-mfa.md §4.1、§5、§6）。
 * 與流程分開：政策與開關改變時不動 `MfaService`／`MfaLoginService` 的流程。
 */
@Injectable()
export class MfaAvailability {
  constructor(private readonly registry: MfaMethodRegistry) {}

  /** 這個身分範圍現在可以用的方式。 */
  async methodsFor(realm: MfaRealm): Promise<MfaMethod[]> {
    const methods = this.registry.list(realm);
    return realm === 'platform'
      ? methods.filter((method) => PLATFORM_METHODS.includes(method.definition.id))
      : methods;
  }

  /** 政策是否要求這個帳號啟用 MFA。 */
  async isRequired(_store: MfaAccountStore, _stored: MfaStoredAccount): Promise<boolean> {
    return false;
  }

  /** 移除因子之前：必須啟用的人不能移除最後一個可用的因子。 */
  async assertCanRemove(
    _store: MfaAccountStore,
    _stored: MfaStoredAccount,
    _factor: MfaFactor,
    _remaining: readonly MfaFactor[],
  ): Promise<void> {}
}
