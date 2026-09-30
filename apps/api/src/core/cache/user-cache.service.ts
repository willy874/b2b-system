import { Injectable } from '@nestjs/common';

import type { UserStatus } from '@/db/schema/users';

import { currentTenant } from '../tenant';
import { InvalidationTracker } from './invalidation-tracker';

export interface CachedUser {
  id: string;
  email: string;
  status: UserStatus;
  tokenVersion: number;
  deletedAt: Date | null;
}

/** JwtAuthGuard 每個請求都要驗證使用者狀態，用 30 秒 TTL 讓成本可接受。 */
const TTL_MS = 30_000;
const MAX_ENTRIES = 10_000;

/**
 * 快取的 key 是「租戶 × 使用者」：一個程序服務所有租戶，只用 userId 會讓 A 租戶的資料被拿去判斷 B 租戶的請求
 * （docs/adr/0020-physical-tenant-isolation.md D17）。沒有租戶脈絡時（單元測試）歸在同一組。
 */
function keyOf(userId: string): string {
  return `${currentTenant()?.id ?? '-'}:${userId}`;
}

@Injectable()
export class UserCacheService {
  private readonly store = new Map<string, { value: CachedUser; expiresAt: number }>();
  private readonly invalidations = new InvalidationTracker(MAX_ENTRIES);

  get(userId: string): CachedUser | undefined {
    const entry = this.store.get(keyOf(userId));
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(keyOf(userId));
      return undefined;
    }
    return entry.value;
  }

  /** 從 DB 載入前取一張票，載入後交給 `set()`：載入期間被失效過（停用、刪除）的結果不寫入（EDGE-09）。 */
  ticket(): number {
    return this.invalidations.ticket();
  }

  /** `ticket` 省略時無條件寫入。 */
  set(user: CachedUser, ticket?: number): void {
    if (ticket !== undefined && !this.invalidations.isFresh(keyOf(user.id), ticket)) return;
    if (this.store.size >= MAX_ENTRIES && !this.store.has(keyOf(user.id))) {
      const oldest = this.store.keys().next();
      if (!oldest.done) this.store.delete(oldest.value);
    }
    this.store.set(keyOf(user.id), { value: user, expiresAt: Date.now() + TTL_MS });
  }

  invalidate(userId: string): void {
    this.invalidations.invalidate(keyOf(userId));
    this.store.delete(keyOf(userId));
  }

  invalidateAll(): void {
    this.invalidations.invalidateAll();
    this.store.clear();
  }
}
