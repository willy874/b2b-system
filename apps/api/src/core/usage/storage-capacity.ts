import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config';
import { AppException } from '../errors';
import { storageTotalChecks, storageTotalLimit, storageTotalUsed } from '../metrics';
import { StorageTotalRepository } from './storage-total.repository';
import type { StorageTotal } from './storage-total.repository';

const MIB = 1024 * 1024;

/** 合計在程序內快取多久：上傳的熱路徑只讀記憶體，平台 DB 每 30 秒最多查一次。 */
const CACHE_TTL_MS = 30_000;

/**
 * 最近一次量測超過這麼久就不擋（彙總的背景工作停了）：止水線是保險，不能讓背景工作的故障變成全平台無法上傳。
 * 彙總預設每 5 分鐘一次，1 小時代表連續失敗了十幾輪。
 */
export const STORAGE_TOTAL_STALE_AFTER_MS = 60 * 60_000;

/**
 * 儲存的止水線（docs/architecture/backend/25-image.md §12 D8）：所有租戶的已用量合計由平台計算（`modules/tenant` 的
 * `storage.totalRollup`），上傳時只讀它。每個租戶自己的容量（`file.storageQuotaMb`）另外由擁有計數的模組判斷。
 */
@Injectable()
export class StorageCapacity {
  private readonly logger = new Logger(StorageCapacity.name);
  /** 位元組；0 = 不啟用。 */
  readonly limitBytes: number;
  private cached?: { value: StorageTotal; at: number };
  private loading?: Promise<StorageTotal>;
  private lastStaleWarningAt = 0;

  constructor(
    private readonly repo: StorageTotalRepository,
    config: ConfigService<Env, true>,
  ) {
    this.limitBytes = config.get('STORAGE_TOTAL_LIMIT_MB', { infer: true }) * MIB;
    storageTotalLimit.observe(this, (report) => report({}, this.limitBytes));
    storageTotalUsed.observe(this, async (report) => report({}, (await this.total()).usedBytes));
  }

  /** 所有租戶最近一次量到的合計（快取 30 秒；同時的請求只查一次）。 */
  async total(): Promise<StorageTotal> {
    if (this.cached && Date.now() - this.cached.at < CACHE_TTL_MS) return this.cached.value;
    this.loading ??= this.repo
      .total()
      .then((value) => {
        this.cached = { value, at: Date.now() };
        return value;
      })
      .finally(() => {
        this.loading = undefined;
      });
    return this.loading;
  }

  /** 彙總寫入新的值之後呼叫：這個程序下一次就讀到新的合計（其他程序最晚 30 秒）。 */
  invalidate(): void {
    this.cached = undefined;
  }

  /**
   * 登記上傳前呼叫（在租戶的容量檢查之前）：加上這次的大小會超過止水線就拋 `STORAGE_TOTAL_LIMIT_REACHED`。
   * 不啟用、還沒有量測、量測過舊、平台 DB 讀不到時都放行。
   */
  async assertCanStore(size: number): Promise<void> {
    if (this.limitBytes === 0) return;
    let total: StorageTotal;
    try {
      total = await this.total();
    } catch (error) {
      this.warnStale({ err: error }, '讀不到所有租戶的已用量，止水線暫時不擋');
      return;
    }
    const measuredAt = total.measuredAt?.getTime();
    if (measuredAt === undefined || Date.now() - measuredAt > STORAGE_TOTAL_STALE_AFTER_MS) {
      this.warnStale(
        { measuredAt: total.measuredAt },
        '所有租戶的已用量太久沒有更新，止水線暫時不擋',
      );
      return;
    }
    if (total.usedBytes + size > this.limitBytes) {
      storageTotalChecks.inc({ result: 'blocked' });
      throw new AppException('STORAGE_TOTAL_LIMIT_REACHED');
    }
    storageTotalChecks.inc({ result: 'allowed' });
  }

  /** 放行並記錄；同樣的警告每 30 秒最多一次，不讓每個上傳都寫一行日誌。 */
  private warnStale(context: Record<string, unknown>, message: string): void {
    storageTotalChecks.inc({ result: 'stale' });
    if (Date.now() - this.lastStaleWarningAt < CACHE_TTL_MS) return;
    this.lastStaleWarningAt = Date.now();
    this.logger.warn(context, message);
  }
}
