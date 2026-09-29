import { Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { requestHost } from '../http';
import type { TrustProxyFn } from '../http';
import { Tenancy } from './tenancy.service';
import { runInTenantContext } from './tenant-context';
import { TenantDirectory } from './tenant-directory.service';

/**
 * 以請求的網域決定租戶（docs/adr/0020-physical-tenant-isolation.md D2）。
 * 找不到租戶時不擋：不需要租戶的路由（健康檢查、之後的平台頁面）照常執行，
 * 需要租戶的程式第一次存取 `TENANT_DB` 時會拋 `TENANT_NOT_FOUND`。租戶停用時回 `TENANT_UNAVAILABLE`。
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    private readonly directory: TenantDirectory,
    private readonly tenancy: Tenancy,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const trust = req.app.get('trust proxy fn') as TrustProxyFn;
    const host = requestHost(req.headers, req.socket.remoteAddress, trust);
    const tenant = host ? await this.directory.resolveHost(host) : undefined;
    if (!tenant) {
      next();
      return;
    }
    runInTenantContext(this.tenancy.contextOf(tenant), () => next());
  }
}
