import { Module } from '@nestjs/common';

import { TotpMfaMethod } from './totp.method';

/** MFA 的方式：驗證器 App（docs/architecture/backend/21-mfa.md §9.1）。`AppModule` 匯入，啟動時登記進註冊表。 */
@Module({ providers: [TotpMfaMethod] })
export class MfaTotpModule {}
