import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import type { Database } from '@/core/database';
import { TENANT_DB, withTransaction } from '@/core/database';
import { defineJob, JobQueue } from '@/core/jobs';
import { CdnPurger, ObjectStorage } from '@/core/storage';
import type { GalleryItemRow } from '@/db/schema';

import { GalleryItemRepository } from './gallery-item.repository';
import { GALLERY_PROCESS_JOB } from './gallery-process.job';
import {
  cdnKeysOf,
  GALLERY_FAILED_TTL_MS,
  GALLERY_KEY_PREFIX,
  GALLERY_MAINTENANCE_BATCH,
  GALLERY_ORPHAN_MIN_AGE_MS,
  GALLERY_PENDING_TTL_MS,
  GALLERY_STUCK_AFTER_MS,
  itemIdOfKey,
  revOfKey,
} from './gallery.constants';

/** 一輪清理的結果（背景工作的 output，管理頁看得到）。 */
export interface GalleryMaintenanceReport {
  /** 登記後超過 24 小時沒完成上傳而刪除的。 */
  abandoned: number;
  /** 處理失敗、超過 7 天而刪除的紀錄。 */
  failed: number;
  /** 清掉舊版本變體的圖片。 */
  staleRevs: number;
  /** 卡住而重新排入處理的。 */
  requeued: number;
  /** 查不到圖片的殘留物件。 */
  orphanObjects: number;
  /** 處理失敗的項目數；下一輪會再偵測到。 */
  failures: number;
}

/** 圖片庫的清理排程（docs/architecture/backend/26-gallery.md §11）。同時段只跑一個（`exclusive`）。 */
export const GALLERY_MAINTENANCE_JOB = defineJob<Record<string, never>>('gallery.maintenance', {
  exclusive: true,
  retryLimit: 2,
  retryDelaySeconds: 60,
  expireInSeconds: 30 * 60,
});

/**
 * 每一步都是冪等的（刪除不存在的東西視為成功、刪除紀錄以條件決勝），中途中斷、重試時重做也不會出錯：
 *
 * 1. 登記後超過 24 小時還沒完成上傳 → 刪除物件與紀錄、釋出容量；
 * 2. 處理失敗超過 7 天（上傳者已經在頁首看過原因）→ 同上；
 * 3. 調整顯示方向之後，舊版本的變體在網址效期過後刪除（物件只寫一次，D14）；
 * 4. 處理卡住（排入超過 30 分鐘、要求的版本還沒寫好）→ 重新排入；
 * 5. `gallery/` 底下查不到圖片的物件（登記失敗、永久刪除時物件刪除失敗）→ 刪除（至少 24 小時前的）。
 *
 * 永久刪除（回收桶到期）由 `trash.purge` 處理（`GalleryItemTrashHandler`）。
 * 刪除變體之後以 `CdnPurger` 排入清理邊緣快取（docs/architecture/backend/09-file.md §16）；沒有 CDN 時是 no-op。
 */
@Injectable()
export class GalleryMaintenanceService implements OnModuleInit {
  private readonly logger = new Logger(GalleryMaintenanceService.name);
  private readonly cron: string;

  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: GalleryItemRepository,
    private readonly storage: ObjectStorage,
    private readonly jobs: JobQueue,
    config: ConfigService<Env, true>,
    private readonly cdn: CdnPurger,
  ) {
    this.cron = config.get('GALLERY_MAINTENANCE_CRON', { infer: true });
  }

  onModuleInit(): void {
    this.jobs.register(GALLERY_MAINTENANCE_JOB, () => this.runScheduled(), { cron: this.cron });
  }

  async sweep(now: Date = new Date()): Promise<GalleryMaintenanceReport> {
    const report: GalleryMaintenanceReport = {
      abandoned: 0,
      failed: 0,
      staleRevs: 0,
      requeued: 0,
      orphanObjects: 0,
      failures: 0,
    };
    const steps: Array<[string, () => Promise<void>]> = [
      [
        'abandoned',
        async () => {
          const rows = await this.repo.findAbandoned(
            new Date(now.getTime() - GALLERY_PENDING_TTL_MS),
            GALLERY_MAINTENANCE_BATCH,
          );
          report.abandoned = await this.purgeUnready(rows, report);
        },
      ],
      [
        'failed',
        async () => {
          const rows = await this.repo.findExpiredFailures(
            new Date(now.getTime() - GALLERY_FAILED_TTL_MS),
            GALLERY_MAINTENANCE_BATCH,
          );
          report.failed = await this.purgeUnready(rows, report);
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
        this.logger.warn({ err: error, step: name }, '圖片庫的清理步驟失敗，下一輪再試');
      }
    }
    return report;
  }

  private async runScheduled(): Promise<GalleryMaintenanceReport> {
    const report = await this.sweep();
    const found =
      report.abandoned + report.failed + report.staleRevs + report.requeued + report.orphanObjects;
    if (found > 0 || report.failures > 0) this.logger.log({ report }, '圖片庫的清理完成');
    return report;
  }

  /** 刪除物件再刪紀錄：紀錄先刪的話，物件刪除失敗就沒人知道它們屬於誰（殘留對帳要等 24 小時）。 */
  private async purgeUnready(
    rows: readonly GalleryItemRow[],
    report: GalleryMaintenanceReport,
  ): Promise<number> {
    const deletable: string[] = [];
    for (const row of rows) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- 一筆一筆來：單一圖片的物件數很少
        await this.deleteObjects(`${GALLERY_KEY_PREFIX}${row.id}/`);
        deletable.push(row.id);
      } catch (error) {
        report.failures += 1;
        this.logger.warn({ err: error, itemId: row.id }, '刪除圖片庫的物件失敗');
      }
    }
    const deleted = await withTransaction(this.db, (tx) => this.repo.deleteUnready(deletable, tx));
    return deleted.length;
  }

  private async purgeStaleRevs(now: Date, report: GalleryMaintenanceReport): Promise<void> {
    const rows = await this.repo.findStaleRevs(now, GALLERY_MAINTENANCE_BATCH);
    for (const row of rows) {
      const { staleRevsPurgeAfter } = row;
      if (!staleRevsPurgeAfter) continue;
      try {
        const stale: string[] = [];
        // oxlint-disable-next-line no-await-in-loop -- 一筆一筆來
        for await (const object of this.storage.listObjects(`${GALLERY_KEY_PREFIX}${row.id}/r`)) {
          const rev = revOfKey(object.key);
          // 目前的版本與還在處理的版本（要求的版本）都要留著
          if (rev !== undefined && rev !== row.variantRev && rev < row.rev) stale.push(object.key);
        }
        // oxlint-disable-next-line no-await-in-loop -- 同上
        await Promise.all(stale.map((key) => this.storage.delete(key)));
        // oxlint-disable-next-line no-await-in-loop -- 同上
        await this.cdn.schedule(stale);
        // oxlint-disable-next-line no-await-in-loop -- 同上
        await this.repo.clearStaleRevs(row.id, staleRevsPurgeAfter);
        report.staleRevs += 1;
      } catch (error) {
        report.failures += 1;
        this.logger.warn({ err: error, itemId: row.id }, '刪除圖片庫的舊版本變體失敗');
      }
    }
  }

  private async requeueStuck(now: Date, report: GalleryMaintenanceReport): Promise<void> {
    const rows = await this.repo.findStuck(
      new Date(now.getTime() - GALLERY_STUCK_AFTER_MS),
      GALLERY_MAINTENANCE_BATCH,
    );
    for (const row of rows) {
      // oxlint-disable-next-line no-await-in-loop -- 數量少；每筆一個入列
      await this.repo.markQueued(row.id);
      // oxlint-disable-next-line no-await-in-loop -- 同上
      await this.jobs.enqueue(GALLERY_PROCESS_JOB, { itemId: row.id });
      report.requeued += 1;
    }
  }

  private async purgeOrphans(now: Date, report: GalleryMaintenanceReport): Promise<void> {
    const cutoff = now.getTime() - GALLERY_ORPHAN_MIN_AGE_MS;
    const byItem = new Map<string, string[]>();
    for await (const object of this.storage.listObjects(GALLERY_KEY_PREFIX)) {
      if (object.lastModified.getTime() > cutoff) continue;
      const id = itemIdOfKey(object.key);
      if (!id) continue;
      const keys = byItem.get(id) ?? [];
      keys.push(object.key);
      byItem.set(id, keys);
    }
    const ids = [...byItem.keys()];
    for (let start = 0; start < ids.length; start += GALLERY_MAINTENANCE_BATCH) {
      const batch = ids.slice(start, start + GALLERY_MAINTENANCE_BATCH);
      // oxlint-disable-next-line no-await-in-loop -- 一批一批對帳
      const existing = await this.repo.existingIds(batch);
      const orphans = batch.filter((id) => !existing.has(id)).flatMap((id) => byItem.get(id) ?? []);
      // oxlint-disable-next-line no-await-in-loop -- 同上
      await Promise.all(orphans.map((key) => this.storage.delete(key)));
      // oxlint-disable-next-line no-await-in-loop -- 同上
      await this.cdn.schedule(cdnKeysOf(orphans));
      report.orphanObjects += orphans.length;
    }
  }

  private async deleteObjects(prefix: string): Promise<void> {
    const keys: string[] = [];
    for await (const object of this.storage.listObjects(prefix)) keys.push(object.key);
    await Promise.all(keys.map((key) => this.storage.delete(key)));
  }
}
