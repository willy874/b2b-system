import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import type { Env } from '@/core/config';
import { ApprovalModule } from '@/modules/approval/approval.module';
import { IdentityProviderModule } from '@/modules/identity-provider/identity-provider.module';
import { OidcProviderModule } from '@/modules/oidc-provider/oidc-provider.module';
import { PlatformAdminModule } from '@/modules/platform-admin/platform-admin.module';
import { UserModule } from '@/modules/user/user.module';

import { AuthTokenModule } from './auth-token.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ExternalLoginService } from './external-login.service';
import { PlatformAuthController } from './platform-auth.controller';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformRefreshTokenRepository } from './platform-refresh-token.repository';
import { SsoInteractionController } from './sso-interaction.controller';
import { SsoService } from './sso.service';

@Module({
  imports: [
    AuthTokenModule,
    UserModule,
    ApprovalModule,
    OidcProviderModule,
    IdentityProviderModule,
    PlatformAdminModule,
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: { algorithm: 'HS256' },
      }),
    }),
  ],
  controllers: [AuthController, SsoInteractionController, PlatformAuthController],
  providers: [
    AuthService,
    SsoService,
    ExternalLoginService,
    PlatformAuthService,
    PlatformRefreshTokenRepository,
  ],
  exports: [AuthService],
})
export class AuthModule {}
