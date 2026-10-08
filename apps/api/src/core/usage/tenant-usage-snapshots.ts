import { Injectable } from '@nestjs/common';

/**
 * 一次快照的量（docs/architecture/05-tenancy.md §5.4）。欄位對應平台 DB `tenant_usage_daily` 的快照欄，
 * 新增一個量要同時加欄位與 migration（寬表，§14.2 D1）。
 */
export interface TenantUsageSnapshot {
  usersActive: number;
  usersTotal: number;
  serviceAccounts: number;
  storageUsedBytes: number;
  storageQuotaBytes: number;
  lastLoginAt: Date | null;
}

/** 在 **目前租戶** 的脈絡裡計算自己負責的量（呼叫端負責進入租戶）。 */
export type TenantUsageCollector = () => Promise<Partial<TenantUsageSnapshot>>;

/**
 * 快照的來源。擁有資料的模組在 `onModuleInit` 登記（使用者數由 `modules/user`、儲存量由 `modules/file`）：
 * core 不認識業務模組（docs/coding-standards/07-layer-dependencies.md §3.2）。
 * 沒有任何模組負責的量在快照裡是 `null`。
 */
@Injectable()
export class TenantUsageSnapshots {
  private readonly collectors = new Map<string, TenantUsageCollector>();

  /** `owner` 是登記的模組名稱，只用來擋重複登記與錯誤訊息。 */
  register(owner: string, collector: TenantUsageCollector): void {
    if (this.collectors.has(owner)) throw new Error(`${owner} 的用量來源重複登記`);
    this.collectors.set(owner, collector);
  }

  /** 依序呼叫每個來源並合併；任一個失敗就整個失敗（交給呼叫端略過這個租戶，不寫入半份快照）。 */
  async collect(): Promise<Partial<TenantUsageSnapshot>> {
    const snapshot: Partial<TenantUsageSnapshot> = {};
    for (const collector of this.collectors.values()) {
      // oxlint-disable-next-line no-await-in-loop -- 同一個租戶的連線上依序查詢，不一次佔用多條連線
      Object.assign(snapshot, await collector());
    }
    return snapshot;
  }
}
