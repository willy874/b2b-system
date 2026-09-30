import { Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';

import type { Env } from '../config';
import { requestHost } from '../http';
import type { TrustProxyFn } from '../http';
import { Tenancy } from './tenancy.service';
import { runInTenantContext } from './tenant-context';
import { TenantDirectory } from './tenant-directory.service';
import type { TenantRecord } from './tenant-directory.service';

/** apps/auth 上的帳號流程（啟用、重設密碼、註冊）指定租戶用的標頭（D26）。 */
export const TENANT_HEADER = 'x-tenant';

/**
 * 以請求的網域決定租戶（docs/adr/0020-physical-tenant-isolation.md D2）。
 *
 * - **apps/auth 的網域不屬於任何租戶**：那裡的請求預設沒有租戶（平台管理者、IdP 的登入互動）。
 *   帳號流程由頁面以 `X-Tenant: <代碼>` 指定租戶；這個標頭只在 apps/auth 的網域有效，
 *   租戶網域上一律以網域為準，不能用標頭換到別的租戶。
 * - 找不到租戶時不擋：不需要租戶的路由（健康檢查、平台的端點）照常執行，
 *   需要租戶的程式第一次存取 `TENANT_DB` 時會拋 `TENANT_NOT_FOUND`。租戶停用時回 `TENANT_UNAVAILABLE`。
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly authHost: string;

  constructor(
    private readonly directory: TenantDirectory,
    private readonly tenancy: Tenancy,
    config: ConfigService<Env, true>,
  ) {
    this.authHost = new URL(config.get('AUTH_APP_URL', { infer: true })).host.toLowerCase();
  }

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const tenant = await this.resolve(req);
    if (!tenant) {
      next();
      return;
    }
    runInTenantContext(await this.tenancy.enter(tenant), () => next());
  }

  private async resolve(req: Request): Promise<TenantRecord | undefined> {
    const trust = req.app.get('trust proxy fn') as TrustProxyFn;
    const host = requestHost(req.headers, req.socket.remoteAddress, trust);
    if (!host) return undefined;
    if (host === this.authHost) {
      const code = req.header(TENANT_HEADER)?.trim();
      return code ? this.directory.findByCode(code) : undefined;
    }
    return this.directory.resolveHost(host);
  }
}
