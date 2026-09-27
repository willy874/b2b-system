import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import { ObjectStorage } from '@/core/storage';

import { FileImageService } from './file-image.service';
import {
  fileIdOfKey,
  IMAGE_VARIANT_RETRY_AFTER_MS,
  MAINTENANCE_BATCH_SIZE,
  MANAGED_KEY_PREFIXES,
  ORIGINAL_KEY_PREFIX,
  thumbnailKeyOf,
} from './file.constants';
import { FileRepository } from './file.repository';

/** 一次維護的結果：每一類「偵測到」的數量；`dryRun` 時只偵測、不處理。 */
export interface FileMaintenanceReport {
  dryRun: boolean;
  /** 登記超過 `FILE_PENDING_TTL` 仍未完成的上傳（紀錄軟刪除，並清掉分塊與已上傳的內容）。 */
  stalePendingFiles: number;
  /** 沒有對應紀錄的分塊上傳（登記時 INSERT 失敗、放棄時 abort 失敗）。 */
  orphanMultipartUploads: number;
  /** 沒有對應紀錄（或紀錄已刪除）的物件：原檔、瀏覽器縮圖、影像變體。 */
  orphanObjects: number;
  /** 卡在 `pending` 而重新排入的影像變體。 */
  requeuedVariants: number;
  /** 處理失敗的項目數；下一輪會再偵測到。 */
  failures: number;
}

/** 首次執行延後，不和啟動時的其他工作搶資源。 */
const FIRST_RUN_DELAY_MS = 60_000;

/**
 * 檔案的維護排程（docs/architecture/backend/09-file.md §9）：偵測並清除上傳失敗留下的殘留，
 * 並補產生卡住的影像變體。
 *
 * 殘留的來源——前端沒機會呼叫「放棄上傳」（分頁當掉、網路中斷）、登記時 INSERT 失敗、
 * 刪除時物件刪除失敗——都不會自己消失，所以定期對帳：
 *
 * 1. `pending` 紀錄超過 `FILE_PENDING_TTL` → 軟刪除紀錄、AbortMultipartUpload、刪除已上傳的內容；
 * 2. 物件儲存裡的分塊上傳沒有對應的紀錄 → AbortMultipartUpload；
 * 3. 受管理前綴（`files/`、`thumbnails/`、`variants/`）下的物件沒有對應的未刪除紀錄 → 刪除；
 * 4. 影像變體卡在 `pending` → 重新排入。
 *
 * 2、3 只看建立早於 `FILE_PENDING_TTL` 的東西：剛登記、INSERT 還沒提交的上傳不會被誤判。
 * 每一步都是冪等的（刪除不存在的東西視為成功、軟刪除以 `WHERE status='pending'` 決勝），
 * 多個 api 執行個體同時跑只是重複做白工，不會出錯；要避免白工可只在一個執行個體開啟。
 */
@Injectable()
export class FileMaintenanceService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(FileMaintenanceService.name);
  private readonly intervalMs: number;
  private readonly pendingTtlMs: number;
  private readonly dryRun: boolean;
  private readonly isTest: boolean;
  private timers: NodeJS.Timeout[] = [];
  private running: Promise<FileMaintenanceReport> | undefined;

  constructor(
    private readonly repo: FileRepository,
    private readonly storage: ObjectStorage,
    private readonly images: FileImageService,
    config: ConfigService<Env, true>,
  ) {
    this.intervalMs = config.get('FILE_MAINTENANCE_INTERVAL', { infer: true }) * 1000;
    this.pendingTtlMs = config.get('FILE_PENDING_TTL', { infer: true }) * 1000;
    this.dryRun = config.get('FILE_MAINTENANCE_DRY_RUN', { infer: true });
    this.isTest = config.get('NODE_ENV', { infer: true }) === 'test';
  }

  onApplicationBootstrap(): void {
    if (this.isTest || this.intervalMs === 0) return;
    const run = () => void this.runScheduled();
    // unref：排程不該讓程序在關機時多撐一個週期
    this.timers = [
      setTimeout(run, FIRST_RUN_DELAY_MS).unref(),
      setInterval(run, this.intervalMs).unref(),
    ];
  }

  onApplicationShutdown(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  /** 執行一輪維護；上一輪還沒結束時直接回傳那一輪的結果，不重疊執行。 */
  sweep(options: { dryRun?: boolean; now?: Date } = {}): Promise<FileMaintenanceReport> {
    this.running ??= this.doSweep(options.dryRun ?? this.dryRun, options.now ?? new Date()).finally(
      () => {
        this.running = undefined;
      },
    );
    return this.running;
  }

  private async runScheduled(): Promise<void> {
    try {
      const report = await this.sweep();
      const found =
        report.stalePendingFiles +
        report.orphanMultipartUploads +
        report.orphanObjects +
        report.requeuedVariants;
      if (found > 0 || report.failures > 0) {
        this.logger.log({ report }, report.dryRun ? '偵測到檔案殘留（未處理）' : '檔案維護完成');
      }
    } catch (error) {
      this.logger.error({ err: error }, '檔案維護失敗，下一輪重試');
    }
  }

  private async doSweep(dryRun: boolean, now: Date): Promise<FileMaintenanceReport> {
    const report: FileMaintenanceReport = {
      dryRun,
      stalePendingFiles: 0,
      orphanMultipartUploads: 0,
      orphanObjects: 0,
      requeuedVariants: 0,
      failures: 0,
    };
    const staleBefore = new Date(now.getTime() - this.pendingTtlMs);
    // 依序執行：先清掉逾時的紀錄，後面的對帳才看得到它們留下的物件。
    // 各步驟互不依賴：一步失敗（例：儲存服務不支援列表）記下後繼續，不讓其他殘留跟著卡住
    const steps = [
      ['discardStalePending', () => this.discardStalePending(staleBefore, dryRun, report)],
      [
        'abortOrphanMultipartUploads',
        () => this.abortOrphanMultipartUploads(staleBefore, dryRun, report),
      ],
      ['deleteOrphanObjects', () => this.deleteOrphanObjects(staleBefore, dryRun, report)],
      ['requeueVariants', () => this.requeueVariants(now, dryRun, report)],
    ] as const;
    for (const [step, run] of steps) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- 見上方：步驟之間有先後
        await run();
      } catch (error) {
        report.failures += 1;
        this.logger.warn({ err: error, step }, '檔案維護的一個步驟失敗，繼續下一步');
      }
    }
    return report;
  }

  private async discardStalePending(
    staleBefore: Date,
    dryRun: boolean,
    report: FileMaintenanceReport,
  ): Promise<void> {
    let afterId: string | undefined;
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- keyset 分頁：下一頁要用這一頁的最後一筆
      const batch = await this.repo.findStalePending(staleBefore, afterId, MAINTENANCE_BATCH_SIZE);
      report.stalePendingFiles += batch.length;
      if (!dryRun) {
        // oxlint-disable-next-line no-await-in-loop -- 一批處理完再查下一批，不同時打開太多請求
        await Promise.all(
          batch.map(async (file) => {
            // 與使用者的 complete 並行時以 WHERE status='pending' 決勝：已完成的不刪
            const discarded = await this.repo.discardPending(file.id, null);
            if (!discarded) return;
            const results = await Promise.allSettled([
              file.uploadId
                ? this.storage.abortMultipartUpload(file.storageKey, file.uploadId)
                : undefined,
              this.storage.delete(file.storageKey),
              this.storage.delete(thumbnailKeyOf(file.id)),
            ]);
            // 物件刪除失敗沒關係：紀錄已刪除，下一輪的孤兒物件對帳會再清一次
            report.failures += results.filter((result) => result.status === 'rejected').length;
          }),
        );
      }
      if (batch.length < MAINTENANCE_BATCH_SIZE) return;
      afterId = batch.at(-1)?.id;
    }
  }

  private async abortOrphanMultipartUploads(
    staleBefore: Date,
    dryRun: boolean,
    report: FileMaintenanceReport,
  ): Promise<void> {
    const flush = async (uploads: { key: string; uploadId: string }[]) => {
      const live = await this.repo.findLiveUploadIds(uploads.map((upload) => upload.uploadId));
      const orphans = uploads.filter((upload) => !live.has(upload.uploadId));
      report.orphanMultipartUploads += orphans.length;
      if (dryRun) return;
      const results = await Promise.allSettled(
        orphans.map((upload) => this.storage.abortMultipartUpload(upload.key, upload.uploadId)),
      );
      report.failures += results.filter((result) => result.status === 'rejected').length;
    };

    let batch: { key: string; uploadId: string }[] = [];
    for await (const upload of this.storage.listMultipartUploads(ORIGINAL_KEY_PREFIX)) {
      if (upload.initiatedAt >= staleBefore) continue;
      batch.push(upload);
      if (batch.length >= MAINTENANCE_BATCH_SIZE) {
        await flush(batch);
        batch = [];
      }
    }
    if (batch.length > 0) await flush(batch);
  }

  private async deleteOrphanObjects(
    staleBefore: Date,
    dryRun: boolean,
    report: FileMaintenanceReport,
  ): Promise<void> {
    const flush = async (objects: { key: string; fileId: string }[]) => {
      const live = await this.repo.findLiveIds([
        ...new Set(objects.map((object) => object.fileId)),
      ]);
      const orphans = objects.filter((object) => !live.has(object.fileId));
      report.orphanObjects += orphans.length;
      if (dryRun) return;
      const results = await Promise.allSettled(
        orphans.map((object) => this.storage.delete(object.key)),
      );
      report.failures += results.filter((result) => result.status === 'rejected').length;
    };

    for (const prefix of MANAGED_KEY_PREFIXES) {
      let batch: { key: string; fileId: string }[] = [];
      // oxlint-disable-next-line no-await-in-loop -- 前綴之間依序對帳，不同時列出整個 bucket
      for await (const object of this.storage.listObjects(prefix)) {
        const fileId = fileIdOfKey(object.key);
        // 不是這個模組產生的 key 一律不碰
        if (!fileId || object.lastModified >= staleBefore) continue;
        batch.push({ key: object.key, fileId });
        if (batch.length >= MAINTENANCE_BATCH_SIZE) {
          await flush(batch);
          batch = [];
        }
      }
      // oxlint-disable-next-line no-await-in-loop -- 同上
      if (batch.length > 0) await flush(batch);
    }
  }

  private async requeueVariants(
    now: Date,
    dryRun: boolean,
    report: FileMaintenanceReport,
  ): Promise<void> {
    const ids = await this.repo.findPendingVariants(
      new Date(now.getTime() - IMAGE_VARIANT_RETRY_AFTER_MS),
      MAINTENANCE_BATCH_SIZE,
    );
    report.requeuedVariants = ids.length;
    if (dryRun) return;
    for (const id of ids) this.images.schedule(id);
  }
}
