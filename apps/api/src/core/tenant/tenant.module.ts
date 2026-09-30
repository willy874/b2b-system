import { Global, Module } from '@nestjs/common';

import { TENANT_DB } from '../database';
import { Tenancy } from './tenancy.service';
import { createTenantDbProxy } from './tenant-db.provider';
import { TenantDirectory } from './tenant-directory.service';
import { TenantMiddleware } from './tenant.middleware';
import { TenantRepository } from './tenant.repository';

/** 租戶的解析、連線池與脈絡（docs/adr/0020-physical-tenant-isolation.md D2、D3）。 */
@Global()
@Module({
  providers: [
    TenantRepository,
    TenantDirectory,
    Tenancy,
    TenantMiddleware,
    { provide: TENANT_DB, useFactory: createTenantDbProxy },
  ],
  exports: [TenantDirectory, Tenancy, TenantMiddleware, TENANT_DB],
})
export class TenancyModule {}
