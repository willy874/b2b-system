import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import { JobQueue } from '@/core/jobs';

import { DataTransferCleanupService } from './data-transfer-cleanup.service';
import {
  DATA_TRANSFER_APPLY_IMPORT_JOB,
  DATA_TRANSFER_CLEANUP_JOB,
  DATA_TRANSFER_EXPORT_JOB,
} from './data-transfer.job-types';
import { DataTransferExportService } from './export/data-transfer-export.service';
import { DataTransferApplyService } from './import/data-transfer-apply.service';

/** 匯入匯出的背景工作（docs/architecture/backend/22-data-transfer.md §6.3、§7.6、§10）。 */
@Injectable()
export class DataTransferJobs implements OnModuleInit {
  constructor(
    private readonly jobs: JobQueue,
    private readonly exports: DataTransferExportService,
    private readonly applies: DataTransferApplyService,
    private readonly cleanup: DataTransferCleanupService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    this.jobs.register(DATA_TRANSFER_EXPORT_JOB, (data, context) =>
      this.exports.run(data.transferId, context),
    );
    this.jobs.register(DATA_TRANSFER_APPLY_IMPORT_JOB, (data, context) =>
      this.applies.run(data.transferId, context),
    );
    this.jobs.register(DATA_TRANSFER_CLEANUP_JOB, () => this.cleanup.run(), {
      cron: this.config.get('DATA_TRANSFER_CLEANUP_CRON', { infer: true }),
    });
  }
}
