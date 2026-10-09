import { Global, Module } from '@nestjs/common';

import { MfaChallengeDelivery } from './mfa-challenge-delivery';
import { MfaMethodSettings } from './mfa-method-settings';
import { MfaMethodRegistry } from './mfa-method.registry';
import { MfaSecretService } from './mfa-secrets';

/**
 * MFA 的機制（docs/architecture/backend/21-mfa.md §1）：方式的註冊表、機密、方式的背景工作讀寫 challenge 的入口。不認識任何方式；
 * 框架在 `modules/mfa`，方式在 `modules/mfa-<id>`。
 */
@Global()
@Module({
  providers: [MfaMethodRegistry, MfaSecretService, MfaChallengeDelivery, MfaMethodSettings],
  exports: [MfaMethodRegistry, MfaSecretService, MfaChallengeDelivery, MfaMethodSettings],
})
export class MfaCoreModule {}
