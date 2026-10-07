import { Injectable } from '@nestjs/common';

import type { MfaAccount } from '@/core/mfa';

import type { MfaAccountStore } from './mfa-account.store';
import type { MfaSecurityEvent } from './mfa-security-event';

/** 安全通知信（docs/architecture/backend/21-mfa.md §7）：在呼叫端的交易內入列，回滾時不寄。 */
@Injectable()
export class MfaNotifier {
  async securityChanged(
    _store: MfaAccountStore,
    _account: MfaAccount,
    _event: MfaSecurityEvent,
    _tx: unknown,
  ): Promise<void> {}
}
