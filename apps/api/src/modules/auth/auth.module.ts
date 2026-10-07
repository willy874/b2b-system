import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { ApprovalModule } from '@/modules/approval/approval.module';
import { CredentialModule } from '@/modules/credential/credential.module';
import { IdentityProviderModule } from '@/modules/identity-provider/identity-provider.module';
import { OidcProviderModule } from '@/modules/oidc-provider/oidc-provider.module';
import { PlatformAdminModule } from '@/modules/platform-admin/platform-admin.module';
import { UserModule } from '@/modules/user/user.module';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ExternalLoginService } from './external-login.service';
import { PlatformAuthController } from './platform-auth.controller';
import { PlatformAuthService } from './platform-auth.service';
import { SsoInteractionController } from './sso-interaction.controller';
import { SsoService } from './sso.service';

@Module({
  imports: [
    CredentialModule,
    UserModule,
    ApprovalModule,
    OidcProviderModule,
    IdentityProviderModule,
    PlatformAdminModule,
    // 不設預設金鑰：簽發與驗證一律經 AccessTokenKeys，依 realm 與 kid 選金鑰（docs/architecture/backend/04-auth.md §11）
    JwtModule.register({ global: true, signOptions: { algorithm: 'HS256' } }),
  ],
  controllers: [AuthController, SsoInteractionController, PlatformAuthController],
  providers: [AuthService, SsoService, ExternalLoginService, PlatformAuthService],
  exports: [AuthService],
})
export class AuthModule {}
