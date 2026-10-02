import { Injectable, Module, RequestMethod } from '@nestjs/common';
import type { MiddlewareConsumer, NestMiddleware, NestModule } from '@nestjs/common';
import type { Request, Response } from 'express';

import { PlatformAdminModule } from '@/modules/platform-admin/platform-admin.module';
import { UserModule } from '@/modules/user/user.module';

import { OidcCleanupJobs } from './oidc-cleanup.jobs';
import { OidcPayloadRepository } from './oidc-payload.repository';
import { OidcProviderService } from './oidc-provider.service';

/** 本程序內 provider 掛載的路徑（反向代理去掉 `/api` 之後）。 */
export const OIDC_MOUNT_PATH = '/oidc';

@Injectable()
class OidcProviderMiddleware implements NestMiddleware {
  constructor(private readonly oidc: OidcProviderService) {}

  use(req: Request, res: Response): void {
    // provider 自己回應所有 /oidc/* 請求（不認識的路徑回 404），不交給 Nest 的路由
    this.oidc.handle(OIDC_MOUNT_PATH)(req, res);
  }
}

/**
 * OIDC Provider（docs/architecture/04-sso.md §12）。葉節點：`AuthModule` 依賴它兌換授權碼與單一登出，
 * 它只依賴 `UserModule` 與 `PlatformAdminModule`（查租戶的使用者與平台管理者）。`/oidc/*` 不是 Nest 的路由，不經全域 guard 與路由稽核；
 * 登入互動的端點在 `AuthModule`（宣告 `@Public()`）。
 */
@Module({
  imports: [UserModule, PlatformAdminModule],
  providers: [OidcPayloadRepository, OidcProviderService, OidcProviderMiddleware, OidcCleanupJobs],
  exports: [OidcProviderService],
})
export class OidcProviderModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(OidcProviderMiddleware)
      .forRoutes({ path: `${OIDC_MOUNT_PATH.slice(1)}/*path`, method: RequestMethod.ALL });
  }
}
