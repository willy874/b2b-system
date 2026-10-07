import { Injectable, Logger } from '@nestjs/common';

import { ObjectStorage } from '@/core/storage';

import { DATA_TRANSFER_SUMMARY_RETENTION_DAYS } from './data-transfer.constants';
import { DataTransferRepository } from './data-transfer.repository';

const BATCH = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DataTransferCleanupReport {
  expired: number;
  deleted: number;
  abortedUploads: number;
  failed: number;
}

/**
 * `dataTransfer.cleanup`（docs/architecture/backend/22-data-transfer.md §10）：每天一次、每個租戶一份。
 * - 到期的傳輸：刪除 `transfers/<id>/` 下的物件與套用列，標成 `expired`；刪除物件失敗只記錄，下一輪再試。
 * - 摘要超過 90 天：刪除紀錄（稽核日誌另有保留）。
 * - 超過一天沒完成的分段上傳（工作在上傳途中被殺掉）：放棄。
 * `file.maintenance` 只管 `files/`、`thumbnails/`、`variants/`，不會碰 `transfers/`。
 */
@Injectable()
export class DataTransferCleanupService {
  private readonly logger = new Logger(DataTransferCleanupService.name);

  constructor(
    private readonly repo: DataTransferRepository,
    private readonly storage: ObjectStorage,
  ) {}

  async run(now = new Date()): Promise<DataTransferCleanupReport> {
    const report: DataTransferCleanupReport = {
      expired: 0,
      deleted: 0,
      abortedUploads: 0,
      failed: 0,
    };
    let afterId: string | null = null;
    for (;;) {
      const batch = await this.repo.findExpired(now, afterId, BATCH);
      for (const transfer of batch) {
        try {
          for await (const object of this.storage.listObjects(`transfers/${transfer.id}/`)) {
            await this.storage.delete(object.key);
          }
          await this.repo.deleteRows(transfer.id);
          const row = await this.repo.transition(
            transfer.id,
            ['completed', 'failed', 'cancelled'],
            {
              status: 'expired',
              outputKey: null,
            },
          );
          if (row) report.expired += 1;
        } catch (error) {
          report.failed += 1;
          this.logger.warn(
            { err: error, transferId: transfer.id },
            '清除到期的匯入匯出失敗，下一輪再試',
          );
        }
      }
      if (batch.length < BATCH) break;
      afterId = batch.at(-1)?.id ?? null;
    }

    const cutoff = new Date(now.getTime() - DATA_TRANSFER_SUMMARY_RETENTION_DAYS * DAY_MS);
    for (;;) {
      const deleted = await this.repo.deleteOlderThan(cutoff, BATCH);
      report.deleted += deleted;
      if (deleted < BATCH) break;
    }

    const staleBefore = now.getTime() - DAY_MS;
    for await (const upload of this.storage.listMultipartUploads('transfers/')) {
      if (upload.initiatedAt.getTime() > staleBefore) continue;
      await this.storage.abortMultipartUpload(upload.key, upload.uploadId);
      report.abortedUploads += 1;
    }
    return report;
  }
}
