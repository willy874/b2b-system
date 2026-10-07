import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import type { UserStatus } from '@/db/schema/users';

import { BroadcastService } from '../broadcast';
import type { BroadcastPublisher } from '../broadcast';
import { cacheEntries, cacheLookups } from '../metrics';
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

/** 平台 DB 上的廣播頻道。 */
export const USER_CACHE_CHANNEL = 'user_cache';
/** 一則廣播最多帶幾個 id：uuid 36 字元，150 個約 6 KB，低於 `NOTIFY` 的 8000 位元組。 */
const IDS_PER_MESSAGE = 150;
/** 沒有租戶脈絡時（平台管理者、單元測試）的組名。 */
const NO_TENANT = '-';

interface UserCacheMessage {
  /** null：平台管理者（沒有租戶脈絡）。 */
  tenant: string | null;
  users: string[];
}

function parseMessage(value: unknown): UserCacheMessage | null {
  if (typeof value !== 'object' || value === null) return null;
  const { tenant, users } = value as Partial<UserCacheMessage>;
  if (tenant !== null && typeof tenant !== 'string') return null;
  if (!Array.isArray(users) || !users.every((id) => typeof id === 'string')) return null;
  return { tenant, users };
}

/**
 * 快取的 key 是「租戶 × 使用者」：一個程序服務所有租戶，只用 userId 會讓 A 租戶的資料被拿去判斷 B 租戶的請求
 * （docs/architecture/05-tenancy.md §10.2 D17）。沒有租戶脈絡時（平台管理者、單元測試）歸在同一組。
 */
function keyOf(userId: string, tenant: string = currentTenant()?.id ?? NO_TENANT): string {
  return `${tenant}:${userId}`;
}

/**
 * 使用者狀態（`status`、`token_version`、刪除）的快取。失效時先清本機，再廣播給其他程序
 * （docs/architecture/06-external-api.md §9.2 D16）：停用、強制登出要在每個程序都立即生效，TTL 只是漏掉廣播時的上限。
 */
@Injectable()
export class UserCacheService implements OnModuleInit {
  private readonly store = new Map<string, { value: CachedUser; expiresAt: number }>();
  private readonly invalidations = new InvalidationTracker(MAX_ENTRIES);
  /** 同一輪事件迴圈內的失效先累積，再合併成少數幾則廣播（例：回收桶一次清掉多個使用者）。 */
  private readonly pending = new Map<string, Set<string>>();
  private publish?: BroadcastPublisher<UserCacheMessage>;

  constructor(private readonly broadcast: BroadcastService) {
    cacheEntries.observe(this, (report) => report({ cache: 'user' }, this.store.size));
  }

  onModuleInit(): void {
    this.publish = this.broadcast.channel(USER_CACHE_CHANNEL, {
      parse: parseMessage,
      onMessage: ({ tenant, users }) => {
        for (const id of users) this.drop(keyOf(id, tenant ?? NO_TENANT));
      },
      onReconnect: () => this.invalidateAll(),
    });
  }

  get(userId: string): CachedUser | undefined {
    const entry = this.store.get(keyOf(userId));
    const isFresh = entry !== undefined && entry.expiresAt >= Date.now();
    cacheLookups.inc({ cache: 'user', result: isFresh ? 'hit' : 'miss' });
    if (!entry) return undefined;
    if (!isFresh) {
      this.store.delete(keyOf(userId));
      return undefined;
    }
    return entry.value;
  }

  /** 從 DB 載入前取一張票，載入後交給 `set()`：載入期間被失效過（停用、刪除）的結果不寫入。 */
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

  /** 本機立即失效，並（合併後）廣播給其他程序。 */
  invalidate(userId: string): void {
    const tenant = currentTenant()?.id ?? NO_TENANT;
    this.drop(keyOf(userId, tenant));
    this.schedulePublish(tenant, userId);
  }

  /** 只清本機（例：監聽連線重連，其他程序各自也會重連）；不廣播。 */
  invalidateAll(): void {
    this.invalidations.invalidateAll();
    this.store.clear();
  }

  private drop(key: string): void {
    this.invalidations.invalidate(key);
    this.store.delete(key);
  }

  private schedulePublish(tenant: string, userId: string): void {
    const publish = this.publish;
    // 還沒經過 onModuleInit（單元測試直接 new）：只有本機
    if (!publish) return;
    const ids = this.pending.get(tenant);
    if (ids) {
      ids.add(userId);
      return;
    }
    this.pending.set(tenant, new Set([userId]));
    queueMicrotask(() => {
      const batch = [...(this.pending.get(tenant) ?? [])];
      this.pending.delete(tenant);
      for (let start = 0; start < batch.length; start += IDS_PER_MESSAGE) {
        void publish({
          tenant: tenant === NO_TENANT ? null : tenant,
          users: batch.slice(start, start + IDS_PER_MESSAGE),
        });
      }
    });
  }
}
