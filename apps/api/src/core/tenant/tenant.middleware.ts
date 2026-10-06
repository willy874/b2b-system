import { Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';

import type { Env } from '../config';
import { AppException } from '../errors';
import { requestHost, setContextPlatformHost } from '../http';
import type { TrustProxyFn } from '../http';
import { Tenancy } from './tenancy.service';
import { runInTenantContext } from './tenant-context';
import { TenantDirectory } from './tenant-directory.service';
import type { TenantRecord } from './tenant-directory.service';

/** apps/platform 上的帳號流程（啟用、重設密碼、註冊）指定租戶用的標頭（D26）。 */
export const TENANT_HEADER = 'x-tenant';

/**
 * 只在 apps/platform 的網域提供的路徑（反向代理已去掉 `/api`）：平台管理者的端點與 IdP 的登入互動
 * （`/oidc/*` 由 provider 的 middleware 自己擋，見 `OidcProviderMiddleware`）。
 * 比對不分大小寫：Express 的路由不分大小寫，`/PLATFORM/tenants` 也會進到 `platform/tenants` 的 handler。
 */
const PLATFORM_ONLY_PATH = /^\/(platform|oidc-interaction)(\/|$)/i;

/**
 * apps/platform 以 `X-Tenant` 指定租戶的帳號流程（D26）：啟用、重設密碼、註冊、租戶的公開設定。
 * 其他路由在 apps/platform 的網域上一律沒有租戶——否則租戶的 access token 也能經由平台網域使用
 * （docs/architecture/04-sso.md §1.1）。比對不上就不採用標頭：沒有租戶是安全的方向。
 */
const TENANT_HEADER_PATH =
  /^\/(auth\/(setup|setup\/verify|register|forgot-password|reset-password)|system\/settings\/public)\/?$/i;

/**
 * 以請求的網域決定租戶（docs/architecture/05-tenancy.md §10.2 D2）。
 *
 * - **apps/platform 的網域不屬於任何租戶**：那裡的請求預設沒有租戶（平台管理者、IdP 的登入互動）。
 *   帳號流程由頁面以 `X-Tenant: <代碼>` 指定租戶；這個標頭只在 apps/platform 的網域、而且只對帳號流程的端點有效
 *   （`TENANT_HEADER_PATH`），租戶網域上一律以網域為準，不能用標頭換到別的租戶。
 * - 找不到租戶時不擋：不需要租戶的路由（健康檢查）照常執行，
 *   需要租戶的程式第一次存取 `TENANT_DB` 時會拋 `TENANT_NOT_FOUND`。租戶停用時回 `TENANT_UNAVAILABLE`。
 * - **平台的端點只在 apps/platform 的網域有效**：其他網域（租戶的、未登記的、直接用 IP）一律 `404 PLATFORM_ONLY`，
 *   只在 apps/platform 網域做的網路控制（WAF、IP 白名單）才保護得到平台管理。
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly authHost: string;

  constructor(
    private readonly directory: TenantDirectory,
    private readonly tenancy: Tenancy,
    config: ConfigService<Env, true>,
  ) {
    this.authHost = new URL(config.get('PLATFORM_APP_URL', { infer: true })).host.toLowerCase();
  }

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const trust = req.app.get('trust proxy fn') as TrustProxyFn;
    const host = requestHost(req.headers, req.socket.remoteAddress, trust);
    const onPlatformHost = host === this.authHost;
    const path = req.originalUrl.split('?')[0] ?? '';
    // guard 與 service 以這個判斷平台端點，不以「沒有租戶」代替
    setContextPlatformHost(onPlatformHost);
    if (!onPlatformHost && PLATFORM_ONLY_PATH.test(path)) throw new AppException('PLATFORM_ONLY');
    const tenant = await this.resolve(req, host, path);
    if (!tenant) {
      next();
      return;
    }
    const context = await this.tenancy.enter(tenant);
    // 以網域找到的租戶記下那個網域（presigned 網址用它簽）；apps/platform 的網域不是租戶的網域
    runInTenantContext(
      host && host !== this.authHost ? { ...context, domain: host } : context,
      () => next(),
    );
  }

  private async resolve(
    req: Request,
    host: string | undefined,
    path: string,
  ): Promise<TenantRecord | undefined> {
    if (!host) return undefined;
    if (host === this.authHost) {
      const code = TENANT_HEADER_PATH.test(path) ? req.header(TENANT_HEADER)?.trim() : undefined;
      return code ? this.directory.findByCode(code) : undefined;
    }
    return this.directory.resolveHost(host);
  }
}
