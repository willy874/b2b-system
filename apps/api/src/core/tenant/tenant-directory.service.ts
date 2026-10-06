import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { TenantRow, TenantStatus } from '@/db/platform/schema';

import { BroadcastService } from '../broadcast';
import type { BroadcastPublisher } from '../broadcast';
// 直接 import 檔案：core/cache 的 index 依賴 core/tenant，經由 index 會形成循環
import { InvalidationTracker } from '../cache/invalidation-tracker';
import type { Env } from '../config';
import { SecretBox, TENANT_SECRET_PURPOSE } from '../crypto';
import { toFeatureFlagOverrides } from '../feature-flags/feature-flags';
import type { FeatureFlagOverrides } from '../feature-flags/feature-flags';
import { hostnameOf } from '../http';
import { BoundedCache } from './bounded-cache';
import { toTenantFeatureParamOverrides } from './tenant-feature-params';
import type { TenantFeatureParamOverrides } from './tenant-feature-params';
import { toTenantFeatures } from './tenant-features';
import type { TenantFeature } from './tenant-features';
import { TenantRepository } from './tenant.repository';

/** 解密後的租戶登記。`databaseUrl` 只在建立連線池時使用，不寫進日誌。 */
export interface TenantRecord {
  id: string;
  code: string;
  name: string;
  status: TenantStatus;
  databaseUrl: string;
  /** 物件儲存的 bucket（D16）。 */
  storageBucket: string;
  /** 啟用的 feature（docs/architecture/frontend/02-plugin-system.md §9.2 D8）；DB 裡不認得的值已濾掉。 */
  features: readonly TenantFeature[];
  /** feature flag 的租戶層覆寫（docs/architecture/05-tenancy.md §11.2 D2）；非布林的值已濾掉。 */
  flags: FeatureFlagOverrides;
  /** feature 參數的覆寫（docs/architecture/05-tenancy.md §13.2 D2）；不在目錄裡或驗證不過的值已濾掉。 */
  featureParams: TenantFeatureParamOverrides;
}

/** 每種查詢最多快取幾筆（租戶數遠小於這個值；上限只是防止被灌爆）。 */
export const TENANT_CACHE_MAX_ENTRIES = 5_000;
/** 平台 DB 上的廣播頻道：租戶登記改了，其他程序整份重新讀（docs/architecture/06-external-api.md §9.2 D16）。 */
export const TENANT_DIRECTORY_CHANNEL = 'tenant_directory';

/** 「找不到」的結果快取多久：key 可能是攻擊者隨意產生的，不必久留。 */
const NEGATIVE_TTL_MS = 5_000;

/**
 * 看起來像網域（含 port、IPv6）的字串才查；其他（超長、怪字元）直接當成找不到。
 * 故意比 `TenantDomainSchema` 寬：舊資料或預設租戶的網域可能不完全符合登記時的規則。
 */
const HOST_LIKE = /^[a-z0-9.\-:[\]]{1,260}$/;
/** 同上，租戶代碼（`X-Tenant`、`/tenants/lookup?code=`）。 */
const CODE_LIKE = /^[a-z0-9][a-z0-9_-]{0,62}$/;

/**
 * 租戶登記的查詢與快取（docs/architecture/05-tenancy.md §10.2 D2）。每個請求都要以網域找租戶，
 * 所以結果快取 `TENANT_CACHE_TTL` 秒（「找不到」只快取數秒）；租戶的狀態改變由 `invalidate()` 立即生效。
 *
 * 網域的請求在 throttler 之前就會解析，而 Host 由客戶端決定：不在「網域 → 租戶」快照裡的 Host 直接視為找不到，
 * 不查平台 DB；快取有上限。
 */
@Injectable()
export class TenantDirectory implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TenantDirectory.name);
  private readonly secrets: SecretBox;
  private readonly ttlMs: number;
  private readonly byHost = new BoundedCache<string, TenantRecord | undefined>(
    TENANT_CACHE_MAX_ENTRIES,
  );
  private readonly byId = new BoundedCache<string, TenantRecord | undefined>(
    TENANT_CACHE_MAX_ENTRIES,
  );
  private readonly byCode = new BoundedCache<string, TenantRecord | undefined>(
    TENANT_CACHE_MAX_ENTRIES,
  );
  /**
   * 載入期間被失效過（停用租戶、改網域的交易剛提交）就不寫回：讀到的可能是舊的登記，會活到 TTL
   * （docs/architecture/05-tenancy.md §10.2 D13 的「本程序立即生效」）。失效一律整份，key 以查詢種類區分。
   */
  private readonly tracker = new InvalidationTracker(TENANT_CACHE_MAX_ENTRIES);
  /** 網域 → 租戶 id 的快照（同步讀取用），每 `TENANT_CACHE_TTL` 秒與 `invalidate()` 時重新載入。 */
  private domains = new Map<string, string>();
  /** 快照是否載入過；還沒有（啟動失敗、DB 暫時連不上）時退回查 DB。 */
  private domainsLoaded = false;
  /** 進行中的重新載入：`invalidate()` 之後的查詢要等它完成，剛登記的網域才找得到。 */
  private refreshing?: Promise<void>;
  /** 第幾次載入快照：較早開始、較晚回來的載入不能蓋掉較新的結果。 */
  private domainsLoadSeq = 0;
  private refreshTimer?: NodeJS.Timeout;
  private publish?: BroadcastPublisher<Record<string, never>>;

  constructor(
    private readonly repo: TenantRepository,
    config: ConfigService<Env, true>,
    private readonly broadcast: BroadcastService,
  ) {
    this.secrets = SecretBox.fromConfig(
      config.get('TENANT_SECRET_KEY', { infer: true }),
      config.get('JWT_SECRET', { infer: true }),
      TENANT_SECRET_PURPOSE,
    );
    this.ttlMs = config.get('TENANT_CACHE_TTL', { infer: true }) * 1000;
  }

  onModuleInit(): void {
    // 訊息沒有內容：租戶數量小，整份重新讀比追蹤是哪一筆簡單
    this.publish = this.broadcast.channel(TENANT_DIRECTORY_CHANNEL, {
      parse: (value) => (typeof value === 'object' && value !== null ? {} : null),
      onMessage: () => this.clear(),
      onReconnect: () => this.clear(),
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.refreshDomains();
    if (this.ttlMs > 0) {
      this.refreshTimer = setInterval(() => void this.refreshDomains(), this.ttlMs);
      this.refreshTimer.unref();
    }
  }

  onModuleDestroy(): void {
    clearInterval(this.refreshTimer);
  }

  /**
   * 同步版的「這個 host 屬於哪個租戶」：oidc-provider 判斷 redirect URI 是同步呼叫，不能查 DB。
   * 讀的是快照，新登記的網域最多晚 `TENANT_CACHE_TTL` 秒生效（`invalidate()` 會立即重載）。
   */
  tenantIdOfHost(host: string): string | undefined {
    const normalized = host.toLowerCase();
    return this.domains.get(normalized) ?? this.domains.get(hostnameOf(normalized));
  }

  /** 只接受完全相符的 `host[:port]`（不退回只比 hostname）：redirect URI 的比對用。 */
  tenantIdOfExactHost(host: string): string | undefined {
    return this.domains.get(host.toLowerCase());
  }

  /** 租戶的主要網域（第一個登記的）；「進入租戶」與帳號流程完成後的登入入口用它。 */
  primaryDomainOf(tenantId: string): string | undefined {
    for (const [domain, owner] of this.domains) if (owner === tenantId) return domain;
    return undefined;
  }

  /**
   * 租戶的主要網域，快照裡沒有時重新載入一次（剛新增網域、或這個程序的快照還沒更新）。仍然沒有就拋錯：
   * 呼叫端（寄信的背景工作）重試，而不是寄出一個指到別的網域的連結。
   */
  async requirePrimaryDomain(tenantId: string): Promise<string> {
    const cached = this.primaryDomainOf(tenantId);
    if (cached) return cached;
    await this.refreshDomains();
    const domain = this.primaryDomainOf(tenantId);
    if (!domain) throw new Error(`租戶 ${tenantId} 沒有任何網域`);
    return domain;
  }

  async findByCode(code: string): Promise<TenantRecord | undefined> {
    const key = code.toLowerCase();
    if (!CODE_LIKE.test(key)) return undefined;
    const cached = this.byCode.get(key);
    if (cached) return cached.value;
    const ticket = this.tracker.ticket();
    const row = await this.repo.findByCode(key);
    return this.remember(
      this.byCode,
      `code:${key}`,
      key,
      row ? this.toRecord(row) : undefined,
      ticket,
    );
  }

  /** 先比對 `host:port`，再比對主機名稱（正式環境的網域通常不帶 port）。 */
  async resolveHost(host: string): Promise<TenantRecord | undefined> {
    const normalized = host.toLowerCase();
    if (!HOST_LIKE.test(normalized)) return undefined;
    const cached = this.byHost.get(normalized);
    if (cached) return cached.value;
    // 快照裡沒有的網域一定不屬於任何租戶：不查 DB、也不佔快取（任意 Host 都會轉進來）
    await this.refreshing;
    if (this.domainsLoaded && this.tenantIdOfHost(normalized) === undefined) return undefined;

    const ticket = this.tracker.ticket();
    const candidates = [...new Set([normalized, hostnameOf(normalized)])];
    const rows = await this.repo.findByDomains(candidates);
    const match = candidates
      .map((candidate) => rows.find((row) => row.domain.toLowerCase() === candidate))
      .find(Boolean);
    return this.remember(
      this.byHost,
      `host:${normalized}`,
      normalized,
      match ? this.toRecord(match.tenant) : undefined,
      ticket,
    );
  }

  async findById(id: string): Promise<TenantRecord | undefined> {
    const cached = this.byId.get(id);
    if (cached) return cached.value;
    const ticket = this.tracker.ticket();
    const row = await this.repo.findById(id);
    return this.remember(this.byId, `id:${id}`, id, row ? this.toRecord(row) : undefined, ticket);
  }

  /** 所有 `active` 的租戶（排程工作展開、清掃 outbox 用）；不快取。 */
  async listActive(): Promise<TenantRecord[]> {
    return (await this.repo.listActive()).map((row) => this.toRecord(row));
  }

  /**
   * 租戶登記改變後呼叫（租戶管理、佈建）；下一次查詢重新讀平台 DB。其他程序經廣播做同一件事，
   * 漏掉時最多晚 `TENANT_CACHE_TTL` 秒。
   */
  invalidate(): void {
    this.clear();
    void this.publish?.({});
  }

  private clear(): void {
    this.tracker.invalidateAll();
    this.byHost.clear();
    this.byId.clear();
    this.byCode.clear();
    void this.refreshDomains();
  }

  private refreshDomains(): Promise<void> {
    const refreshing = this.loadDomains().finally(() => {
      if (this.refreshing === refreshing) this.refreshing = undefined;
    });
    this.refreshing = refreshing;
    return refreshing;
  }

  private async loadDomains(): Promise<void> {
    const seq = ++this.domainsLoadSeq;
    try {
      const rows = await this.repo.listDomains();
      // 之後又開始了一次載入（例：invalidate()）：以較新的那次為準，不讓先開始的舊結果蓋掉它
      if (seq !== this.domainsLoadSeq) return;
      this.domains = new Map(rows.map((row) => [row.domain.toLowerCase(), row.tenantId]));
      this.domainsLoaded = true;
    } catch (error) {
      // 沿用上一份快照；下一輪再試
      this.logger.error({ err: error }, '載入租戶網域失敗');
    }
  }

  private toRecord(row: TenantRow): TenantRecord {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      status: row.status,
      databaseUrl: this.secrets.decrypt(row.databaseUrlEncrypted),
      storageBucket: row.storageBucket,
      features: toTenantFeatures(row.features),
      flags: toFeatureFlagOverrides(row.flags),
      featureParams: toTenantFeatureParamOverrides(row.featureParams),
    };
  }

  /**
   * 寫進快取並回傳。查詢期間被失效過（`ticket` 之後有 `invalidate()`）就只回傳、不寫：
   * 這個結果可能是失效之前讀到的，寫回去會讓停用的租戶在本程序再活一個 TTL。
   */
  private remember(
    cache: BoundedCache<string, TenantRecord | undefined>,
    trackerKey: string,
    key: string,
    record: TenantRecord | undefined,
    ticket: number,
  ): TenantRecord | undefined {
    if (this.tracker.isFresh(trackerKey, ticket)) {
      cache.set(key, record, record ? this.ttlMs : Math.min(this.ttlMs, NEGATIVE_TTL_MS));
    }
    return record;
  }
}
