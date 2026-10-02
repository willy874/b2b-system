import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';

import { requireTenant, Tenancy } from '@/core/tenant';

import { ApiTokenRepository } from './api-token.repository';

/** 多久寫一次 `last_used_at`。 */
const FLUSH_INTERVAL_MS = 60_000;

/**
 * `api_tokens.last_used_at`（docs/architecture/06-external-api.md §9.2 D8）：每個請求都寫一次會讓唯讀的請求也變成寫入，
 * 所以先記在記憶體，每分鐘依租戶批次更新。程序結束前再寫一次；當掉時最多少記一分鐘。
 */
@Injectable()
export class ApiTokenUsageService implements OnApplicationShutdown {
  private readonly logger = new Logger(ApiTokenUsageService.name);
  /** 租戶 id → 這一輪用過的 token id。 */
  private pending = new Map<string, Set<string>>();
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly repo: ApiTokenRepository,
    private readonly tenancy: Tenancy,
  ) {}

  /** 在目前租戶的請求裡呼叫。第一次呼叫才開始計時（內部 api 從不呼叫，不會有計時器）。 */
  record(tokenId: string): void {
    const tenantId = requireTenant().id;
    const ids = this.pending.get(tenantId) ?? new Set<string>();
    ids.add(tokenId);
    this.pending.set(tenantId, ids);
    if (!this.timer) {
      this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
      this.timer.unref();
    }
  }

  async flush(): Promise<void> {
    const batch = this.pending;
    this.pending = new Map();
    const at = new Date();
    for (const [tenantId, ids] of batch) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- 依序進入每個租戶，不一次打開所有租戶的連線
        await this.tenancy.run(tenantId, () => this.repo.touch([...ids], at));
      } catch (error) {
        // 租戶停用或維護中：最後使用時間少記一次，不影響驗證
        this.logger.warn({ err: error, tenantId }, '更新 API token 的最後使用時間失敗');
      }
    }
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.flush();
  }
}
