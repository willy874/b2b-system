import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import { AppException } from '@/core/errors';
import { requireTenant, TenantDirectory } from '@/core/tenant';

import type { CurrentTenantDto, TenantLookupDto } from './dto/tenant.dto';

/** backstage 上的登入頁（每個租戶的網域都一樣）。 */
const TENANT_LOGIN_PATH = '/auth/login';

/**
 * 租戶的公開資訊（docs/adr/0020-physical-tenant-isolation.md D7、D11）：只有代碼、名稱與登入入口，
 * 不透露連線、狀態或網域清單。租戶的建立與管理在交付順序第 4 步。
 */
@Injectable()
export class TenantService {
  private readonly protocol: string;

  constructor(
    private readonly directory: TenantDirectory,
    config: ConfigService<Env, true>,
  ) {
    this.protocol = new URL(config.get('APP_PUBLIC_URL', { infer: true })).protocol;
  }

  /** 目前網域的租戶；不屬於任何租戶的網域拋 `TENANT_NOT_FOUND`。 */
  async current(): Promise<CurrentTenantDto> {
    const tenant = await this.directory.findById(requireTenant().id);
    if (!tenant) throw new AppException('TENANT_NOT_FOUND');
    return { code: tenant.code, name: tenant.name };
  }

  /** 找不到、停用或沒有網域的租戶一律 `TENANT_NOT_FOUND`（不區分，避免探測租戶狀態）。 */
  async lookup(code: string): Promise<TenantLookupDto> {
    const tenant = await this.directory.findByCode(code);
    const domain =
      tenant?.status === 'active' ? this.directory.primaryDomainOf(tenant.id) : undefined;
    if (!tenant || !domain) throw new AppException('TENANT_NOT_FOUND');
    return {
      code: tenant.code,
      name: tenant.name,
      loginUrl: `${this.protocol}//${domain}${TENANT_LOGIN_PATH}`,
    };
  }
}
