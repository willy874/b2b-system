import { Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';

import type { Env } from '../config';
import { AppException } from '../errors';
import { requestHost } from '../http';
import type { TrustProxyFn } from '../http';
import { Tenancy } from './tenancy.service';
import { runInTenantContext } from './tenant-context';
import { TenantDirectory } from './tenant-directory.service';
import type { TenantRecord } from './tenant-directory.service';

/** apps/platform 上的帳號流程（啟用、重設密碼、註冊）指定租戶用的標頭（D26）。 */
export const TENANT_HEADER = 'x-tenant';

/** 平台管理者的端點（`/platform/*`，反向代理已去掉 `/api`）。 */
const PLATFORM_PATH = /^\/platform(\/|$)/;

/**
 * 以請求的網域決定租戶（docs/architecture/05-tenancy.md §10.2 D2）。
 *
 * - **apps/platform 的網域不屬於任何租戶**：那裡的請求預設沒有租戶（平台管理者、IdP 的登入互動）。
 *   帳號流程由頁面以 `X-Tenant: <代碼>` 指定租戶；這個標頭只在 apps/platform 的網域有效，
 *   租戶網域上一律以網域為準，不能用標頭換到別的租戶。
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
    if (host !== this.authHost && PLATFORM_PATH.test(req.originalUrl.split('?')[0] ?? '')) {
      throw new AppException('PLATFORM_ONLY');
    }
    const tenant = await this.resolve(req, host);
    if (!tenant) {
      next();
      return;
    }
    runInTenantContext(await this.tenancy.enter(tenant), () => next());
  }

  private async resolve(req: Request, host: string | undefined): Promise<TenantRecord | undefined> {
    if (!host) return undefined;
    if (host === this.authHost) {
      const code = req.header(TENANT_HEADER)?.trim();
      return code ? this.directory.findByCode(code) : undefined;
    }
    return this.directory.resolveHost(host);
  }
}
