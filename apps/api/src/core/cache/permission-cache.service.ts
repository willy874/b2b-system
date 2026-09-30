import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { PermissionKey } from '@/db/seeds/permissions';

import type { Env } from '../config';
import { currentTenant } from '../tenant';
import { InvalidationTracker } from './invalidation-tracker';

export interface PermissionSet {
  /** 持有的權限鍵；由關係圖解析時含權限依賴樹的閉包（docs/rbac/02-permission-catalog.md §9）。 */
  permissions: Set<PermissionKey>;
  isSuperAdmin: boolean;
  /**
   * 關係圖的主體閉包（本人、`user:*`、`role:<id>#holder`…）：解析資源授權時沿用，不必再查一次。
   * 由舊的解析產生時沒有。
   */
  subjects?: readonly string[];
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
  private readonly invalidations = new InvalidationTracker(MAX_ENTRIES);
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

  /** 從 DB 載入前取一張票，載入後交給 `set()`：載入期間被失效過的結果不寫入。 */
  ticket(): number {
    return this.invalidations.ticket();
  }

  /** `ticket` 省略時無條件寫入（呼叫端確定讀到的是最新資料時）。 */
  set(userId: string, value: PermissionSet, ticket?: number): void {
    if (ticket !== undefined && !this.invalidations.isFresh(keyOf(userId), ticket)) return;
    if (this.store.size >= MAX_ENTRIES && !this.store.has(keyOf(userId))) {
      const oldest = this.store.keys().next();
      if (!oldest.done) this.store.delete(oldest.value);
    }
    this.store.set(keyOf(userId), { value, expiresAt: Date.now() + this.ttl });
  }

  invalidate(userId: string): void {
    this.invalidations.invalidate(keyOf(userId));
    this.store.delete(keyOf(userId));
  }

  invalidateMany(userIds: readonly string[]): void {
    for (const id of userIds) this.invalidate(id);
  }

  invalidateAll(): void {
    this.invalidations.invalidateAll();
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
