import { Injectable } from '@nestjs/common';

/** 在 **目前租戶** 的脈絡裡回報已用的儲存量（位元組；呼叫端負責進入租戶）。 */
export type TenantStorageUsageSource = () => Promise<number>;

/**
 * 租戶已用的儲存量的來源（docs/architecture/backend/25-image.md §12）。擁有計數的模組在 `onModuleInit` 登記
 * （檔案的 `file_storage_usage`；圖片資產與圖片庫維護同一個計數，docs/architecture/backend/25-image.md §16.2 D3），
 * core 不認識業務模組（docs/coding-standards/07-layer-dependencies.md §3.2）。
 */
@Injectable()
export class TenantStorageUsage {
  private readonly sources = new Map<string, TenantStorageUsageSource>();

  /** `owner` 是登記的模組名稱，只用來擋重複登記與錯誤訊息。 */
  register(owner: string, source: TenantStorageUsageSource): void {
    if (this.sources.has(owner)) throw new Error(`${owner} 的儲存量來源重複登記`);
    this.sources.set(owner, source);
  }

  /** 各來源的合計；任一個失敗就整個失敗（交給呼叫端略過這個租戶，保留上一次的值）。 */
  async used(): Promise<number> {
    let total = 0;
    for (const source of this.sources.values()) {
      // oxlint-disable-next-line no-await-in-loop -- 同一個租戶的連線上依序查詢
      total += await source();
    }
    return total;
  }
}
