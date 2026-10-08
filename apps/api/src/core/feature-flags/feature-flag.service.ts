import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BroadcastService } from '../broadcast';
import type { BroadcastPublisher } from '../broadcast';
import type { Env } from '../config';
import { currentTenant } from '../tenant';
import { FeatureFlagRepository } from './feature-flag.repository';
import { FEATURE_FLAG_GLOBAL_STATES, catalogProblems, resolveFeatureFlag } from './feature-flags';
import type { FeatureFlagDefinition, FeatureFlagGlobalState } from './feature-flags';

/** flag 的目錄（預設 `FEATURE_FLAGS`）；測試以 `overrideProvider` 換成自己的目錄。 */
export const FEATURE_FLAG_CATALOG = Symbol('FEATURE_FLAG_CATALOG');

/** 全平台層的覆寫變更時通知其他程序重新讀取（docs/architecture/01-system.md §4.3）。 */
export const FEATURE_FLAG_CHANNEL = 'feature_flags';

/**
 * flag 的判斷（docs/architecture/05-tenancy.md §11.2 D3、D4）。`isEnabled` 是同步的：租戶層的覆寫在 `TenantContext.flags`
 * （與 `features` 一起由 `TenantDirectory` 載入），全平台層快取在這裡：變更時經 `core/broadcast` 通知其他程序重新讀取，
 * 另每 `TENANT_CACHE_TTL` 秒重新讀取一次，作為廣播漏掉時的上限。
 */
@Injectable()
export class FeatureFlagService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(FeatureFlagService.name);
  private readonly byKey: ReadonlyMap<string, FeatureFlagDefinition>;
  private readonly ttlMs: number;
  private global = new Map<string, FeatureFlagGlobalState>();
  private refreshTimer?: NodeJS.Timeout;
  private publish?: BroadcastPublisher<Record<string, never>>;

  constructor(
    @Inject(FEATURE_FLAG_CATALOG) readonly catalog: readonly FeatureFlagDefinition[],
    private readonly repo: FeatureFlagRepository,
    private readonly broadcast: BroadcastService,
    config: ConfigService<Env, true>,
  ) {
    const problems = catalogProblems(catalog);
    if (problems.length) {
      throw new Error(
        `feature flag 的目錄有錯（core/feature-flags/feature-flags.ts）：\n  - ${problems.join('\n  - ')}`,
      );
    }
    this.byKey = new Map(catalog.map((flag) => [flag.key, flag]));
    this.ttlMs = config.get('TENANT_CACHE_TTL', { infer: true }) * 1000;
  }

  onModuleInit(): void {
    this.publish = this.broadcast.channel(FEATURE_FLAG_CHANNEL, {
      parse: (value) => (typeof value === 'object' && value !== null ? {} : null),
      onMessage: () => this.reload(),
      onReconnect: () => this.reload(),
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.reload();
    if (this.ttlMs > 0) {
      this.refreshTimer = setInterval(() => void this.reload(), this.ttlMs);
      this.refreshTimer.unref();
    }
  }

  onModuleDestroy(): void {
    clearInterval(this.refreshTimer);
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }

  /** 全平台層目前的覆寫（沒有 = 不覆寫）。 */
  globalStateOf(key: string): FeatureFlagGlobalState | undefined {
    return this.global.get(key);
  }

  /**
   * 目前生效的值。在租戶脈絡裡算上租戶層的覆寫；沒有租戶脈絡（背景工作的平台工作、平台端點）只看全平台層與預設值。
   * 不在目錄裡的 key 一律關：flag 移除後遺留的判斷不會意外打開。
   */
  isEnabled(key: string): boolean {
    const definition = this.byKey.get(key);
    if (!definition) return false;
    return resolveFeatureFlag(definition, this.global.get(key), currentTenant()?.flags[key]);
  }

  /** 生效為開的 key，依目錄的順序（`/auth/profile` 的 `flags`，D6）。 */
  enabledKeys(): string[] {
    return this.catalog.filter((flag) => this.isEnabled(flag.key)).map((flag) => flag.key);
  }

  /** 改了全平台層之後：本機立即重讀，再通知其他程序。 */
  async changed(): Promise<void> {
    await this.reload();
    await this.publish?.({});
  }

  /** 重新讀取全平台層；讀取失敗時沿用上一份（與租戶網域的快照相同）。 */
  async reload(): Promise<void> {
    try {
      const rows = await this.repo.listGlobal();
      this.global = new Map(
        rows
          .filter((row) => (FEATURE_FLAG_GLOBAL_STATES as readonly string[]).includes(row.state))
          .map((row) => [row.key, row.state]),
      );
    } catch (error) {
      this.logger.error({ err: error }, '載入 feature flag 的全平台覆寫失敗');
    }
  }
}
