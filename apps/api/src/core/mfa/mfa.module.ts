import { Global, Module } from '@nestjs/common';

import { MfaMethodRegistry } from './mfa-method.registry';
import { MfaSecretService } from './mfa-secrets';

/**
 * MFA 的機制（docs/architecture/backend/21-mfa.md §1）：方式的註冊表與機密。不認識任何方式；
 * 框架在 `modules/mfa`，方式在 `modules/mfa-<id>`。
 */
@Global()
@Module({
  providers: [MfaMethodRegistry, MfaSecretService],
  exports: [MfaMethodRegistry, MfaSecretService],
})
export class MfaCoreModule {}
