import { Module } from '@nestjs/common';

import { SmsGateway } from './sms-gateway';
import { SmsMfaMethod } from './sms.method';

/**
 * MFA 的方式：簡訊驗證碼（docs/architecture/backend/21-mfa.md §9.4）。`AppModule` 匯入，啟動時登記進註冊表。
 * 只依賴 `core/mfa`：供應商的參數經 `MfaMethodSettings`、challenge 的讀寫經 `MfaChallengeDelivery`。
 */
@Module({ providers: [SmsMfaMethod, SmsGateway] })
export class MfaSmsModule {}
