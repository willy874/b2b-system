import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { BroadcastService } from '../broadcast';
import type { BroadcastPublisher } from '../broadcast';
import { requireTenant } from '../tenant';
import { InvalidationTracker } from './invalidation-tracker';

/** 驗證一把 API token 需要的欄位（不含名稱等顯示用的）。 */
export interface CachedApiToken {
  id: string;
  userId: string;
  secretHash: string;
  /** 限縮到的權限鍵；null＝跟著帳號。 */
  scopes: readonly string[] | null;
  accountVersion: number;
  expiresAt: Date;
  revokedAt: Date | null;
}

/**
 * 最壞情況下撤銷後還能用多久：撤銷會主動失效並廣播（D17），這只是漏掉廣播時的上限。
 * 比使用者快取（30 秒）短：token 是外流時第一個要撤銷的東西。
 */
const TTL_MS = 10_000;
const MAX_ENTRIES = 10_000;

/** 平台 DB 上的廣播頻道。 */
export const API_TOKEN_CACHE_CHANNEL = 'api_token_cache';
/** 一則廣播最多帶幾個 id（同 `user_cache`）。 */
const IDS_PER_MESSAGE = 150;

interface ApiTokenCacheMessage {
  tenant: string;
  tokens: string[];
}

function parseMessage(value: unknown): ApiTokenCacheMessage | null {
  if (typeof value !== 'object' || value === null) return null;
  const { tenant, tokens } = value as Partial<ApiTokenCacheMessage>;
  if (typeof tenant !== 'string') return null;
  if (!Array.isArray(tokens) || !tokens.every((id) => typeof id === 'string')) return null;
  return { tenant, tokens };
}

/** token id 只在自己的租戶 DB 有意義：key 一定帶租戶（docs/adr/0020-physical-tenant-isolation.md D17）。 */
function keyOf(tenant: string, tokenId: string): string {
  return `${tenant}:${tokenId}`;
}

/**
 * 對外 API 驗證 token 的快取（docs/adr/0027-api-tokens-external-api.md D17）：每個請求都要以 token id 查
 * `api_tokens`，快取 10 秒。撤銷在內部 api 發生、驗證在對外 API，所以失效一定要廣播。
 * 帳號的停用、`token_version` 由使用者快取負責（它也會廣播），這裡只管 token 本身。
 */
@Injectable()
export class ApiTokenCacheService implements OnModuleInit {
  private readonly store = new Map<string, { value: CachedApiToken; expiresAt: number }>();
  private readonly invalidations = new InvalidationTracker(MAX_ENTRIES);
  private publish?: BroadcastPublisher<ApiTokenCacheMessage>;

  constructor(private readonly broadcast: BroadcastService) {}

  onModuleInit(): void {
    this.publish = this.broadcast.channel(API_TOKEN_CACHE_CHANNEL, {
      parse: parseMessage,
      onMessage: ({ tenant, tokens }) => {
        for (const id of tokens) this.drop(keyOf(tenant, id));
      },
      onReconnect: () => {
        this.invalidations.invalidateAll();
        this.store.clear();
      },
    });
  }

  /** 目前租戶的這把 token。 */
  get(tokenId: string): CachedApiToken | undefined {
    const key = keyOf(requireTenant().id, tokenId);
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /** 從 DB 載入前取一張票，載入後交給 `set()`：載入期間被撤銷過的結果不寫入（同使用者快取）。 */
  ticket(): number {
    return this.invalidations.ticket();
  }

  set(token: CachedApiToken, ticket: number): void {
    const key = keyOf(requireTenant().id, token.id);
    if (!this.invalidations.isFresh(key, ticket)) return;
    if (this.store.size >= MAX_ENTRIES && !this.store.has(key)) {
      const oldest = this.store.keys().next();
      if (!oldest.done) this.store.delete(oldest.value);
    }
    this.store.set(key, { value: token, expiresAt: Date.now() + TTL_MS });
  }

  /** 撤銷之後（交易提交後）呼叫：本機立即失效，並廣播給其他程序。 */
  invalidate(tokenIds: readonly string[]): void {
    if (!tokenIds.length) return;
    const tenant = requireTenant().id;
    for (const id of tokenIds) this.drop(keyOf(tenant, id));
    for (let start = 0; start < tokenIds.length; start += IDS_PER_MESSAGE) {
      void this.publish?.({ tenant, tokens: tokenIds.slice(start, start + IDS_PER_MESSAGE) });
    }
  }

  private drop(key: string): void {
    this.invalidations.invalidate(key);
    this.store.delete(key);
  }
}
