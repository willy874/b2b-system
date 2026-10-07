import { Module } from '@nestjs/common';

import { EmailMfaMethod } from './email.method';

/**
 * MFA 的方式：Email 驗證碼（docs/architecture/backend/21-mfa.md §9.2）。`AppModule` 匯入，啟動時登記進註冊表。
 * 只依賴 `core/mfa`：challenge 的讀寫經 `MfaChallengeDelivery`，不依賴 `modules/mfa`。
 */
@Module({ providers: [EmailMfaMethod] })
export class MfaEmailModule {}
