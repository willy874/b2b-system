import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';

import { ExternalOidcClient, OpenIdExternalOidcClient } from './external-oidc.client';
import { IdentityProviderController } from './identity-provider.controller';
import { IdentityProviderRepository } from './identity-provider.repository';
import { IdentityProviderService } from './identity-provider.service';

/**
 * 外部 IdP 連線（docs/adr/0019-sso-identity-platform.md D8–D11）。葉節點：`AuthModule` 依賴它做網域導向、
 * 只允許 SSO 的檢查與外部登入；它不依賴任何業務模組。
 */
@Module({
  controllers: [IdentityProviderController],
  providers: [
    IdentityProviderService,
    IdentityProviderRepository,
    {
      provide: ExternalOidcClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new OpenIdExternalOidcClient(config.get('NODE_ENV', { infer: true }) !== 'production'),
    },
  ],
  exports: [IdentityProviderService, ExternalOidcClient],
})
export class IdentityProviderModule {}
