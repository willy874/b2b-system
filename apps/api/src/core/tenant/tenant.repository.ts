import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import type { TenantRow } from '@/db/platform/schema';
import { tenantDomains, tenants } from '@/db/platform/schema';

import { PLATFORM_DB } from '../database';
import type { PlatformDatabase } from '../database';

/** 平台 DB 的租戶登記（只有查詢；建立與佈建在第 4 步的 `modules/tenant`）。 */
@Injectable()
export class TenantRepository {
  constructor(@Inject(PLATFORM_DB) private readonly db: PlatformDatabase) {}

  /** 依網域找租戶；`domains` 依優先順序排列，回傳每個命中的網域。 */
  async findByDomains(domains: string[]): Promise<Array<{ domain: string; tenant: TenantRow }>> {
    if (!domains.length) return [];
    return this.db
      .select({ domain: tenantDomains.domain, tenant: tenants })
      .from(tenantDomains)
      .innerJoin(tenants, eq(tenants.id, tenantDomains.tenantId))
      .where(and(inArray(tenantDomains.domain, domains), isNull(tenants.deletedAt)));
  }

  async findById(id: string): Promise<TenantRow | undefined> {
    const [row] = await this.db
      .select()
      .from(tenants)
      .where(and(eq(tenants.id, id), isNull(tenants.deletedAt)))
      .limit(1);
    return row;
  }

  async findByCode(code: string): Promise<TenantRow | undefined> {
    const [row] = await this.db
      .select()
      .from(tenants)
      .where(and(eq(tenants.code, code), isNull(tenants.deletedAt)))
      .limit(1);
    return row;
  }

  /** 所有未刪除租戶的網域（依建立順序；每個租戶的第一個網域是它的主要網域）。 */
  async listDomains(): Promise<Array<{ domain: string; tenantId: string }>> {
    return this.db
      .select({ domain: tenantDomains.domain, tenantId: tenantDomains.tenantId })
      .from(tenantDomains)
      .innerJoin(tenants, eq(tenants.id, tenantDomains.tenantId))
      .where(isNull(tenants.deletedAt))
      .orderBy(tenantDomains.createdAt, tenantDomains.domain);
  }

  async listActive(): Promise<TenantRow[]> {
    return this.db
      .select()
      .from(tenants)
      .where(and(eq(tenants.status, 'active'), isNull(tenants.deletedAt)))
      .orderBy(tenants.code);
  }
}
