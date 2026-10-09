import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import type { Database } from '@/core/database';
import { TENANT_DB, withTransaction } from '@/core/database';
import { defineJob, JobQueue } from '@/core/jobs';
import { ObjectStorage } from '@/core/storage';
import type { ImageAssetRow } from '@/db/schema';
import { TrashService } from '@/modules/trash/trash.service';

import { ImageAssetRepository } from './image-asset.repository';
import { IMAGE_PROCESS_JOB } from './image-process.job';
import {
  assetIdOfKey,
  IMAGE_KEY_PREFIX,
  IMAGE_MAINTENANCE_BATCH,
  IMAGE_ORPHAN_MIN_AGE_MS,
  IMAGE_STUCK_AFTER_MS,
  IMAGE_UNCLAIMED_TTL_MS,
  revOfKey,
} from './image.constants';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 一輪清理的結果（背景工作的 output，管理頁看得到）。 */
export interface ImageMaintenanceReport {
  /** 沒被認領、超過 24 小時而刪除的資產。 */
  unclaimed: number;
  /** 被換掉、超過回收桶保留期限而刪除的資產。 */
  detached: number;
  /** 清掉舊版本變體的資產。 */
  staleRevs: number;
  /** 查不到資產的殘留物件。 */
  orphanObjects: number;
  /** 卡住而重新排入處理的資產。 */
  requeued: number;
  /** 處理失敗的項目數；下一輪會再偵測到。 */
  failures: number;
}

/**
 * 圖片資產的清理排程（docs/architecture/backend/25-image.md §15.6）。同時段只跑一個（`exclusive`）。
 */
export const IMAGE_MAINTENANCE_JOB = defineJob<Record<string, never>>('image.maintenance', {
  exclusive: true,
  retryLimit: 2,
  retryDelaySeconds: 60,
  expireInSeconds: 30 * 60,
});

/**
 * 每一步都是冪等的（刪除不存在的東西視為成功、刪除紀錄以條件決勝），中途中斷、重試時重做也不會出錯：
 *
 * 1. 沒被認領（上傳了但沒按儲存）超過 24 小時 → 刪除物件與紀錄、釋出容量；
 * 2. 被換掉、或擁有者被永久刪除，超過回收桶的保留期限 → 同上（期間仍出現在「最近使用」）；
 * 3. 重新裁切之後，舊版本的變體在網址效期過後刪除（物件只寫一次，D12）；
 * 4. 處理卡住（排入超過 30 分鐘、要求的版本還沒寫好）→ 重新排入；
 * 5. `images/` 底下查不到資產的物件（登記失敗、刪除時物件刪除失敗）→ 刪除（至少 24 小時前的）。
 *
 * 物件刪除之後，之後的 CDN 在這裡清理邊緣快取（docs/features/image-cdn.md §7）。
 */
@Injectable()
export class ImageMaintenanceService implements OnModuleInit {
  private readonly logger = new Logger(ImageMaintenanceService.name);
  private readonly cron: string;

  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: ImageAssetRepository,
    private readonly storage: ObjectStorage,
    private readonly jobs: JobQueue,
    private readonly trash: TrashService,
    config: ConfigService<Env, true>,
  ) {
    this.cron = config.get('IMAGE_MAINTENANCE_CRON', { infer: true });
  }

  onModuleInit(): void {
    this.jobs.register(IMAGE_MAINTENANCE_JOB, () => this.runScheduled(), { cron: this.cron });
  }

  async sweep(now: Date = new Date()): Promise<ImageMaintenanceReport> {
    const report: ImageMaintenanceReport = {
      unclaimed: 0,
      detached: 0,
      staleRevs: 0,
      orphanObjects: 0,
      requeued: 0,
      failures: 0,
    };
    const retentionDays = await this.trash.retentionDays();
    const steps: Array<[string, () => Promise<void>]> = [
      [
        'unclaimed',
        async () => {
          const rows = await this.repo.findUnclaimed(
            new Date(now.getTime() - IMAGE_UNCLAIMED_TTL_MS),
            IMAGE_MAINTENANCE_BATCH,
          );
          report.unclaimed = await this.purge(rows, report);
        },
      ],
      [
        'detached',
        async () => {
          const rows = await this.repo.findDetached(
            new Date(now.getTime() - retentionDays * DAY_MS),
            IMAGE_MAINTENANCE_BATCH,
          );
          report.detached = await this.purge(rows, report);
        },
      ],
      ['staleRevs', () => this.purgeStaleRevs(now, report)],
      ['requeue', () => this.requeueStuck(now, report)],
      ['orphans', () => this.purgeOrphans(now, report)],
    ];
    for (const [name, step] of steps) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- 依序：前面的步驟刪掉的紀錄，後面的對帳才看得到
        await step();
      } catch (error) {
        report.failures += 1;
        this.logger.warn({ err: error, step: name }, '圖片資產的清理步驟失敗，下一輪再試');
      }
    }
    return report;
  }

  private async runScheduled(): Promise<ImageMaintenanceReport> {
    const report = await this.sweep();
    const found =
      report.unclaimed +
      report.detached +
      report.staleRevs +
      report.orphanObjects +
      report.requeued;
    if (found > 0 || report.failures > 0) this.logger.log({ report }, '圖片資產的清理完成');
    return report;
  }

  /** 刪除物件再刪紀錄：紀錄先刪的話，物件刪除失敗就沒人知道它們屬於誰（殘留對帳要等 24 小時）。 */
  private async purge(
    rows: readonly ImageAssetRow[],
    report: ImageMaintenanceReport,
  ): Promise<number> {
    const deletable: string[] = [];
    for (const row of rows) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- 一筆一筆來：單一資產的物件數很少
        await this.deleteObjects(`${IMAGE_KEY_PREFIX}${row.id}/`);
        deletable.push(row.id);
      } catch (error) {
        report.failures += 1;
        this.logger.warn({ err: error, assetId: row.id }, '刪除圖片資產的物件失敗');
      }
    }
    const deleted = await withTransaction(this.db, (tx) => this.repo.deleteRows(deletable, tx));
    return deleted.length;
  }

  private async purgeStaleRevs(now: Date, report: ImageMaintenanceReport): Promise<void> {
    const rows = await this.repo.findStaleRevs(now, IMAGE_MAINTENANCE_BATCH);
    for (const row of rows) {
      const { staleRevsPurgeAfter } = row;
      if (!staleRevsPurgeAfter) continue;
      try {
        const stale: string[] = [];
        // oxlint-disable-next-line no-await-in-loop -- 一筆一筆來
        for await (const object of this.storage.listObjects(`${IMAGE_KEY_PREFIX}${row.id}/r`)) {
          const rev = revOfKey(object.key);
          // 目前的版本與還在處理的版本（要求的版本）都要留著
          if (rev !== undefined && rev !== row.variantRev && rev < row.rev) stale.push(object.key);
        }
        // oxlint-disable-next-line no-await-in-loop -- 同上
        await Promise.all(stale.map((key) => this.storage.delete(key)));
        // oxlint-disable-next-line no-await-in-loop -- 同上
        await this.repo.clearStaleRevs(row.id, staleRevsPurgeAfter);
        report.staleRevs += 1;
      } catch (error) {
        report.failures += 1;
        this.logger.warn({ err: error, assetId: row.id }, '刪除圖片資產的舊版本失敗');
      }
    }
  }

  private async requeueStuck(now: Date, report: ImageMaintenanceReport): Promise<void> {
    const rows = await this.repo.findStuck(
      new Date(now.getTime() - IMAGE_STUCK_AFTER_MS),
      IMAGE_MAINTENANCE_BATCH,
    );
    for (const row of rows) {
      // oxlint-disable-next-line no-await-in-loop -- 數量少；每筆一個入列
      await this.repo.markQueued(row.id);
      // oxlint-disable-next-line no-await-in-loop -- 同上
      await this.jobs.enqueue(IMAGE_PROCESS_JOB, { assetId: row.id });
      report.requeued += 1;
    }
  }

  private async purgeOrphans(now: Date, report: ImageMaintenanceReport): Promise<void> {
    const cutoff = now.getTime() - IMAGE_ORPHAN_MIN_AGE_MS;
    const byAsset = new Map<string, string[]>();
    for await (const object of this.storage.listObjects(IMAGE_KEY_PREFIX)) {
      if (object.lastModified.getTime() > cutoff) continue;
      const id = assetIdOfKey(object.key);
      if (!id) continue;
      const keys = byAsset.get(id) ?? [];
      keys.push(object.key);
      byAsset.set(id, keys);
    }
    const ids = [...byAsset.keys()];
    for (let start = 0; start < ids.length; start += IMAGE_MAINTENANCE_BATCH) {
      const batch = ids.slice(start, start + IMAGE_MAINTENANCE_BATCH);
      // oxlint-disable-next-line no-await-in-loop -- 一批一批對帳
      const existing = await this.repo.existingIds(batch);
      const orphans = batch
        .filter((id) => !existing.has(id))
        .flatMap((id) => byAsset.get(id) ?? []);
      // oxlint-disable-next-line no-await-in-loop -- 同上
      await Promise.all(orphans.map((key) => this.storage.delete(key)));
      report.orphanObjects += orphans.length;
    }
  }

  private async deleteObjects(prefix: string): Promise<void> {
    const keys: string[] = [];
    for await (const object of this.storage.listObjects(prefix)) keys.push(object.key);
    await Promise.all(keys.map((key) => this.storage.delete(key)));
  }
}
