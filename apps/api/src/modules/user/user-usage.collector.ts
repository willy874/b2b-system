import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { TenantUsageSnapshots } from '@/core/usage';

import { UserRepository } from './user.repository';

/** 租戶用量快照的使用者數、服務帳號數與最後登入（docs/architecture/05-tenancy.md §5.4）。 */
@Injectable()
export class UserUsageCollector implements OnModuleInit {
  constructor(
    private readonly snapshots: TenantUsageSnapshots,
    private readonly repo: UserRepository,
  ) {}

  onModuleInit(): void {
    this.snapshots.register('user', () => this.repo.usageCounts());
  }
}
