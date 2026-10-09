import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';

import { cdnSettings } from '@/db/platform/schema';
import type { CdnSettingsRow } from '@/db/platform/schema';

import { BroadcastService } from '../broadcast';
import type { BroadcastPublisher } from '../broadcast';
import type { Env } from '../config';
import { PLATFORM_DB } from '../database';
import type { PlatformDatabase } from '../database';
import { CDN_RESOURCE_TYPES, isCdnResource } from './cdn-resource';
import type { CdnResource } from './cdn-resource';

/** 寫入後通知其他程序重新讀取（docs/architecture/01-system.md §4.4）：內部 api 的各角色與對外 API 的程序。 */
export const CDN_SETTINGS_CHANNEL = 'cdn_settings';

/** 唯一一列的 id（`CHECK (id = 'default')`）。 */
export const CDN_SETTINGS_ID = 'default';

/** 執行期的效期上限不能低於它（與 `FILE_CDN_MAX_URL_TTL` 的下限相同）。 */
export const CDN_MIN_URL_TTL = 300;

/** 存放的覆寫值（null = 跟著環境變數）。 */
export type CdnStoredOverrides = Pick<
  CdnSettingsRow,
  'state' | 'resources' | 'urlTtlCap' | 'purgeOnDelete' | 'purgeBatchSize'
>;

/** 部署層（環境變數）的能力、上限與預設值。 */
export interface CdnDeploymentLimits {
  resources: ReadonlySet<CdnResource>;
  maxUrlTtl: number;
  purgeOnDelete: boolean;
  purgeBatchSize: number;
}

/** 生效值（docs/architecture/backend/09-file.md §16.9）。 */
export interface CdnEffective {
  /** 簽章要不要用 CDN（`state` 沒有覆寫時是開）。 */
  serving: boolean;
  /** 依 `CDN_RESOURCE_TYPES` 的順序。 */
  resources: CdnResource[];
  urlTtlCap: number;
  purgeOnDelete: boolean;
  purgeBatchSize: number;
  /** 存放值超過部署的上限、讀取時被裁切的部分（頁面標示「超過部署的上限」）；不改寫 DB。 */
  clamped: { resources: CdnResource[]; urlTtlCap: boolean };
}

/**
 * 生效值的解析（docs/architecture/backend/09-file.md §16.9、§17 D12）。**沒有列（或每個欄位都是 null）時與只有環境變數時完全相同**；
 * 環境變數是上限：資源類型取交集、效期取較小者；清理的兩項以環境變數為預設值。清理不看 `state`（§17 D13）。
 * DB 裡不認得的資源類型（程式移除了某種資源）直接忽略。
 */
export function resolveCdnEffective(
  limits: CdnDeploymentLimits,
  stored: CdnStoredOverrides | undefined,
): CdnEffective {
  const known = new Set((stored?.resources ?? []).filter(isCdnResource));
  const resources = stored?.resources
    ? CDN_RESOURCE_TYPES.filter((type) => known.has(type) && limits.resources.has(type))
    : CDN_RESOURCE_TYPES.filter((type) => limits.resources.has(type));
  const ttl = stored?.urlTtlCap ?? limits.maxUrlTtl;
  return {
    serving: (stored?.state ?? 'on') === 'on',
    resources,
    urlTtlCap: Math.min(ttl, limits.maxUrlTtl),
    purgeOnDelete: stored?.purgeOnDelete ?? limits.purgeOnDelete,
    purgeBatchSize: stored?.purgeBatchSize ?? limits.purgeBatchSize,
    clamped: {
      resources: CDN_RESOURCE_TYPES.filter(
        (type) => known.has(type) && !limits.resources.has(type),
      ),
      urlTtlCap: ttl > limits.maxUrlTtl,
    },
  };
}

/** 平台 DB 的 `cdn_settings`（讀取）；寫入在 `modules/platform-cdn`。 */
@Injectable()
export class CdnSettingsRepository {
  constructor(@Inject(PLATFORM_DB) private readonly db: PlatformDatabase) {}

  async find(): Promise<CdnSettingsRow | undefined> {
    const [row] = await this.db
      .select()
      .from(cdnSettings)
      .where(eq(cdnSettings.id, CDN_SETTINGS_ID))
      .limit(1);
    return row;
  }
}

/**
 * CDN 的執行期設定的快取（docs/architecture/backend/09-file.md §16.9）。每次簽網址都要判斷，不能查 DB：
 * 啟動時載入、同步讀取；寫入後本機重讀並經 `BroadcastService` 的 `cdn_settings` 通知其他程序，
 * 另每 `TENANT_CACHE_TTL` 秒重新讀取一次（廣播不保證送達，docs/architecture/01-system.md §4.4）。
 *
 * 切換是最終一致的，但不會出錯：presigned 與 CDN 網址在各自的效期內都有效。沒有部署 CDN（`FILE_CDN_ENABLED=false`）時不載入也不訂閱。
 */
@Injectable()
export class CdnSettings implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CdnSettings.name);
  private readonly deployed: boolean;
  private readonly ttlMs: number;
  private row: CdnSettingsRow | undefined;
  private refreshTimer?: NodeJS.Timeout;
  private publish?: BroadcastPublisher<Record<string, never>>;

  constructor(
    private readonly repo: CdnSettingsRepository,
    private readonly broadcast: BroadcastService,
    config: ConfigService<Env, true>,
  ) {
    this.deployed = config.get('FILE_CDN_ENABLED', { infer: true });
    this.ttlMs = config.get('TENANT_CACHE_TTL', { infer: true }) * 1000;
  }

  onModuleInit(): void {
    if (!this.deployed) return;
    this.publish = this.broadcast.channel(CDN_SETTINGS_CHANNEL, {
      parse: (value) => (typeof value === 'object' && value !== null ? {} : null),
      onMessage: () => this.reload(),
      onReconnect: () => this.reload(),
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.deployed) return;
    await this.reload();
    if (this.ttlMs > 0) {
      this.refreshTimer = setInterval(() => void this.reload(), this.ttlMs);
      this.refreshTimer.unref();
    }
  }

  onModuleDestroy(): void {
    clearInterval(this.refreshTimer);
  }

  /** 目前的列（沒有列 = 全部沒有覆寫）。每次重讀都換成新的物件：`CdnConfig` 以物件身分判斷要不要重算生效值。 */
  current(): CdnSettingsRow | undefined {
    return this.row;
  }

  /** 讀取失敗時沿用上一份（與 feature flag 的全平台層相同）。 */
  async reload(): Promise<void> {
    try {
      this.row = await this.repo.find();
    } catch (error) {
      this.logger.error({ err: error }, '載入 CDN 的執行期設定失敗，沿用上一份');
    }
  }

  /** 寫入之後：本機立即重讀，再通知其他程序。 */
  async changed(): Promise<void> {
    await this.reload();
    await this.publish?.({});
  }
}
