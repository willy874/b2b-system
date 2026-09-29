import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { PermissionKey } from '@/db/seeds/permissions';

import type { Env } from '../config';
import { currentTenant } from '../tenant';

export interface PermissionSet {
  permissions: Set<PermissionKey>;
  isSuperAdmin: boolean;
}

interface Entry {
  value: PermissionSet;
  expiresAt: number;
}

/** 異常情況下的上限，避免無限成長（docs/architecture/backend/05-rbac.md §5.3）。 */
const MAX_ENTRIES = 10_000;

/**
 * 快取的 key 是「租戶 × 使用者」：一個程序服務所有租戶，只用 userId 會讓 A 租戶的資料被拿去判斷 B 租戶的請求
 * （docs/adr/0020-physical-tenant-isolation.md D17）。沒有租戶脈絡時（單元測試）歸在同一組。
 */
function keyOf(userId: string): string {
  return `${currentTenant()?.id ?? '-'}:${userId}`;
}

@Injectable()
export class PermissionCacheService {
  private readonly store = new Map<string, Entry>();
  private readonly ttl: number;

  constructor(config: ConfigService<Env, true>) {
    this.ttl = config.get('PERMISSION_CACHE_TTL', { infer: true }) * 1000;
  }

  get(userId: string): PermissionSet | undefined {
    const entry = this.store.get(keyOf(userId));
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(keyOf(userId));
      return undefined;
    }
    return entry.value;
  }

  set(userId: string, value: PermissionSet): void {
    if (this.store.size >= MAX_ENTRIES && !this.store.has(keyOf(userId))) {
      const oldest = this.store.keys().next();
      if (!oldest.done) this.store.delete(oldest.value);
    }
    this.store.set(keyOf(userId), { value, expiresAt: Date.now() + this.ttl });
  }

  invalidate(userId: string): void {
    this.store.delete(keyOf(userId));
  }

  invalidateMany(userIds: readonly string[]): void {
    for (const id of userIds) this.store.delete(keyOf(id));
  }

  invalidateAll(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
