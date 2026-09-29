import { Injectable } from '@nestjs/common';
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
export class TenantDirectory {
  private readonly secrets: SecretBox;
  private readonly ttlMs: number;
  private readonly byHost = new Map<string, Cached<TenantRecord | undefined>>();
  private readonly byId = new Map<string, Cached<TenantRecord | undefined>>();

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
  }

  private toRecord(row: TenantRow): TenantRecord {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      status: row.status,
      databaseUrl: this.secrets.decrypt(row.databaseUrlEncrypted),
    };
  }

  private entry<T>(value: T): Cached<T> {
    return { value, expiresAt: Date.now() + this.ttlMs };
  }

  private fresh<T>(cached: Cached<T> | undefined): Cached<T> | undefined {
    return cached && cached.expiresAt > Date.now() ? cached : undefined;
  }
}
