import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';

import { ExternalOidcClient, OpenIdExternalOidcClient } from './external-oidc.client';
import { ExternalSamlClient, NodeSamlExternalClient } from './external-saml.client';
import { IdentityProviderController } from './identity-provider.controller';
import { IdentityProviderRepository } from './identity-provider.repository';
import { IdentityProviderService } from './identity-provider.service';
import { UserIdentityController } from './user-identity.controller';

/**
 * 外部 IdP 連線（docs/architecture/04-sso.md §12.2 D8–D11、§12.6；OIDC 與 SAML 2.0）。`AuthModule` 依賴它做網域導向、
 * 只允許 SSO 的檢查與外部登入；它只依賴全域的葉節點（稽核、權限），不依賴其他業務模組。
 */
@Module({
  controllers: [IdentityProviderController, UserIdentityController],
  providers: [
    IdentityProviderService,
    IdentityProviderRepository,
    { provide: ExternalSamlClient, useClass: NodeSamlExternalClient },
    {
      provide: ExternalOidcClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const production = config.get('NODE_ENV', { infer: true }) === 'production';
        return new OpenIdExternalOidcClient({
          allowInsecureIssuer: !production,
          blockPrivateNetworks: production,
        });
      },
    },
  ],
  exports: [IdentityProviderService, ExternalOidcClient, ExternalSamlClient],
})
export class IdentityProviderModule {}
