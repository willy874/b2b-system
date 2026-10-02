import { Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { parseToken } from '@/common/auth';
import { extractBearer } from '@/common/guards';
import { runInTenantContext, Tenancy, TenantDirectory } from '@/core/tenant';

/**
 * 對外 API 以 token 的租戶代碼決定租戶，不看網域（docs/architecture/06-external-api.md §9.2 D7、D9）：
 * 全平台只有一個對外網域。代碼只是「去哪個租戶 DB 找」的提示，secret 要在那裡比對成功才算數（`ApiTokenVerifier`）。
 *
 * 沒帶 token、格式不對、代碼找不到時不擋：不需要租戶的路由（健康檢查）照常執行，其餘由 `ApiTokenAuthGuard` 回 401。
 * 租戶停用或維護中時 `Tenancy.enter` 回 `TENANT_UNAVAILABLE`（503），與內部 api 相同。
 */
@Injectable()
export class TokenTenantMiddleware implements NestMiddleware {
  constructor(
    private readonly directory: TenantDirectory,
    private readonly tenancy: Tenancy,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const raw = extractBearer(req.headers.authorization);
    const parsed = raw ? parseToken(raw) : null;
    const tenant = parsed ? await this.directory.findByCode(parsed.tenantCode) : undefined;
    if (!tenant) {
      next();
      return;
    }
    runInTenantContext(await this.tenancy.enter(tenant), () => next());
  }
}
