import { Global, Module } from '@nestjs/common';

import { TENANT_DB } from '../database';
import { Tenancy } from './tenancy.service';
import { createTenantDbProxy } from './tenant-db.provider';
import { TenantDirectory } from './tenant-directory.service';
import { TenantFeatureImpacts } from './tenant-feature-impacts';
import { TenantMiddleware } from './tenant.middleware';
import { TenantRepository } from './tenant.repository';

/** 租戶的解析、連線池與脈絡（docs/architecture/05-tenancy.md §10.2 D2、D3）。 */
@Global()
@Module({
  providers: [
    TenantRepository,
    TenantDirectory,
    Tenancy,
    TenantMiddleware,
    TenantFeatureImpacts,
    { provide: TENANT_DB, useFactory: createTenantDbProxy },
  ],
  exports: [TenantDirectory, Tenancy, TenantMiddleware, TenantFeatureImpacts, TENANT_DB],
})
export class TenancyModule {}
