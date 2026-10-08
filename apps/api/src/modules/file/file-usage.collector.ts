import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { FILE_STORAGE_QUOTA_MB_PARAM, tenantFeatureParam } from '@/core/tenant';
import { TenantUsageSnapshots } from '@/core/usage';

import { FileRepository } from './file.repository';

const MIB = 1024 * 1024;

/**
 * 租戶用量快照的儲存量與配額（docs/architecture/05-tenancy.md §5.4）：與上傳時判斷配額的是同一個數字
 * （`file_storage_usage`，含上傳中與回收桶裡的檔案），使用率才會和「還能上傳多少」一致。
 */
@Injectable()
export class FileUsageCollector implements OnModuleInit {
  constructor(
    private readonly snapshots: TenantUsageSnapshots,
    private readonly repo: FileRepository,
  ) {}

  onModuleInit(): void {
    this.snapshots.register('file', async () => ({
      storageUsedBytes: await this.repo.storageUsed(),
      storageQuotaBytes: tenantFeatureParam(FILE_STORAGE_QUOTA_MB_PARAM) * MIB,
    }));
  }
}
