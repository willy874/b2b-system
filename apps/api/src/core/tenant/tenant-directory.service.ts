import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { TenantRow, TenantStatus } from '@/db/platform/schema';

import type { Env } from '../config';
import { SecretBox, TENANT_SECRET_PURPOSE } from '../crypto';
import { hostnameOf } from '../http';
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
}

interface Cached<T> {
  value: T;
  expiresAt: number;
}

/**
 * 租戶登記的查詢與快取（docs/adr/0020-physical-tenant-isolation.md D2）。每個請求都要以網域找租戶，
 * 所以結果（含「找不到」）快取 `TENANT_CACHE_TTL` 秒；租戶的狀態改變由 `invalidate()` 立即生效。
 */
@Injectable()
export class TenantDirectory implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TenantDirectory.name);
  private readonly secrets: SecretBox;
  private readonly ttlMs: number;
  private readonly byHost = new Map<string, Cached<TenantRecord | undefined>>();
  private readonly byId = new Map<string, Cached<TenantRecord | undefined>>();
  private readonly byCode = new Map<string, Cached<TenantRecord | undefined>>();
  /** 網域 → 租戶 id 的快照（同步讀取用），每 `TENANT_CACHE_TTL` 秒與 `invalidate()` 時重新載入。 */
  private domains = new Map<string, string>();
  private refreshTimer?: NodeJS.Timeout;

  constructor(
    private readonly repo: TenantRepository,
    config: ConfigService<Env, true>,
  ) {
    this.secrets = SecretBox.fromConfig(
      config.get('TENANT_SECRET_KEY', { infer: true }),
      config.get('JWT_SECRET', { infer: true }),
      TENANT_SECRET_PURPOSE,
    );
    this.ttlMs = config.get('TENANT_CACHE_TTL', { infer: true }) * 1000;
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

  /** 租戶的主要網域（第一個登記的）；「進入租戶」與帳號流程完成後的登入入口用它。 */
  primaryDomainOf(tenantId: string): string | undefined {
    for (const [domain, owner] of this.domains) if (owner === tenantId) return domain;
    return undefined;
  }

  async findByCode(code: string): Promise<TenantRecord | undefined> {
    const key = code.toLowerCase();
    const cached = this.fresh(this.byCode.get(key));
    if (cached) return cached.value;
    const row = await this.repo.findByCode(key);
    const record = row ? this.toRecord(row) : undefined;
    this.byCode.set(key, this.entry(record));
    return record;
  }

  /** 先比對 `host:port`，再比對主機名稱（正式環境的網域通常不帶 port）。 */
  async resolveHost(host: string): Promise<TenantRecord | undefined> {
    const cached = this.fresh(this.byHost.get(host));
    if (cached) return cached.value;
    const candidates = [...new Set([host, hostnameOf(host)])];
    const rows = await this.repo.findByDomains(candidates);
    const match = candidates
      .map((candidate) => rows.find((row) => row.domain.toLowerCase() === candidate))
      .find(Boolean);
    const record = match ? this.toRecord(match.tenant) : undefined;
    this.byHost.set(host, this.entry(record));
    return record;
  }

  async findById(id: string): Promise<TenantRecord | undefined> {
    const cached = this.fresh(this.byId.get(id));
    if (cached) return cached.value;
    const row = await this.repo.findById(id);
    const record = row ? this.toRecord(row) : undefined;
    this.byId.set(id, this.entry(record));
    return record;
  }

  /** 所有 `active` 的租戶（排程工作展開、清掃 outbox 用）；不快取。 */
  async listActive(): Promise<TenantRecord[]> {
    return (await this.repo.listActive()).map((row) => this.toRecord(row));
  }

  /** 租戶登記改變後呼叫（第 4 步的租戶管理）；下一次查詢重新讀平台 DB。 */
  invalidate(): void {
    this.byHost.clear();
    this.byId.clear();
    this.byCode.clear();
    void this.refreshDomains();
  }

  private async refreshDomains(): Promise<void> {
    try {
      const rows = await this.repo.listDomains();
      this.domains = new Map(rows.map((row) => [row.domain.toLowerCase(), row.tenantId]));
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
    };
  }

  private entry<T>(value: T): Cached<T> {
    return { value, expiresAt: Date.now() + this.ttlMs };
  }

  private fresh<T>(cached: Cached<T> | undefined): Cached<T> | undefined {
    return cached && cached.expiresAt > Date.now() ? cached : undefined;
  }
}
