import { Module } from '@nestjs/common';

import { CredentialModule } from '@/modules/credential/credential.module';
import { OidcProviderModule } from '@/modules/oidc-provider/oidc-provider.module';
import { UserModule } from '@/modules/user/user.module';

import { UserMfaController, PlatformAdminMfaController } from './mfa-admin.controller';
import { MfaAdminService } from './mfa-admin.service';
import { MfaAvailability } from './mfa-availability.service';
import { MfaCleanupJobs } from './mfa-cleanup.jobs';
import { MfaInteractionController } from './mfa-interaction.controller';
import { MfaLoginService } from './mfa-login.service';
import { MfaMethodOverrideRepository } from './mfa-method-override.repository';
import { MfaMethodOverrideService } from './mfa-method-override.service';
import { MfaMethodSettingsRepository } from './mfa-method-settings.repository';
import { MfaMethodSettingsService } from './mfa-method-settings.service';
import { MfaNotifier } from './mfa-notifier';
import { MfaPolicyController } from './mfa-policy.controller';
import { MfaPolicyRepository } from './mfa-policy.repository';
import { MfaPolicyService } from './mfa-policy.service';
import { MfaSelfController, PlatformMfaSelfController } from './mfa-self.controller';
import { MfaService } from './mfa.service';
import { PlatformMfaMethodController } from './platform-mfa-method.controller';
import { PlatformMfaMethodService } from './platform-mfa-method.service';
import { PlatformMfaRepository } from './platform-mfa.repository';
import { PlatformMfaStore } from './platform-mfa.store';
import { TenantMfaRepository } from './tenant-mfa.repository';
import { TenantMfaStore } from './tenant-mfa.store';

/**
 * MFA 的框架（docs/architecture/backend/21-mfa.md §1）：流程、儲存、端點。只透過 `MfaMethodRegistry`（`core/mfa`）
 * 呼叫方式，不 import 任何方式的模組；方式（`modules/mfa-<id>`）由 `AppModule` 匯入、在 `onModuleInit` 登記。
 * `AuthModule` 依賴這裡（登入互動的第二步、直接登入的拒絕），所以這裡不能依賴 `AuthModule`：
 * 密碼登入的檢查與鎖定在 `UserModule`（`UserLoginService`）與 `PlatformAdminModule`。
 */
@Module({
  imports: [CredentialModule, UserModule, OidcProviderModule],
  controllers: [
    MfaInteractionController,
    MfaSelfController,
    PlatformMfaSelfController,
    UserMfaController,
    PlatformAdminMfaController,
    MfaPolicyController,
    PlatformMfaMethodController,
  ],
  providers: [
    MfaService,
    MfaLoginService,
    MfaAdminService,
    MfaAvailability,
    MfaNotifier,
    TenantMfaRepository,
    PlatformMfaRepository,
    TenantMfaStore,
    PlatformMfaStore,
    MfaCleanupJobs,
    MfaMethodOverrideRepository,
    MfaMethodOverrideService,
    MfaMethodSettingsRepository,
    MfaMethodSettingsService,
    MfaPolicyRepository,
    MfaPolicyService,
    PlatformMfaMethodService,
  ],
  exports: [MfaService, MfaLoginService],
})
export class MfaModule {}
