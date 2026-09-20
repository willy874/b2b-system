import { Injectable } from '@nestjs/common';

import type { UserStatus } from '@/db/schema/users';

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

@Injectable()
export class UserCacheService {
  private readonly store = new Map<string, { value: CachedUser; expiresAt: number }>();

  get(userId: string): CachedUser | undefined {
    const entry = this.store.get(userId);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(userId);
      return undefined;
    }
    return entry.value;
  }

  set(user: CachedUser): void {
    if (this.store.size >= MAX_ENTRIES && !this.store.has(user.id)) {
      const oldest = this.store.keys().next();
      if (!oldest.done) this.store.delete(oldest.value);
    }
    this.store.set(user.id, { value: user, expiresAt: Date.now() + TTL_MS });
  }

  invalidate(userId: string): void {
    this.store.delete(userId);
  }

  invalidateAll(): void {
    this.store.clear();
  }
}
