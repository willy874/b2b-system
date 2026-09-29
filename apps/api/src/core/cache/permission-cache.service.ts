import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { PermissionKey } from '@/db/seeds/permissions';

import type { Env } from '../config';

export interface PermissionSet {
  permissions: Set<PermissionKey>;
  isSuperAdmin: boolean;
  /**
   * 工作區範圍的集合：能不能進入這個工作區——成員，或 super-admin；工作區不存在或已刪除一律 false。
   * 平台範圍的集合恆為 true（docs/adr/0018-workspace-tenancy.md D5、D9）。
   */
  canEnter: boolean;
}

interface Entry {
  value: PermissionSet;
  expiresAt: number;
}

/** 異常情況下的上限，避免無限成長（docs/architecture/backend/05-rbac.md §5.3）。 */
const MAX_ENTRIES = 10_000;

/** 平台範圍的 key；工作區範圍用工作區 id（uuid 不會與它相撞）。 */
const PLATFORM_SCOPE = '-';

/**
 * 權限集合的快取，key 是「使用者 × 範圍」（平台，或某個工作區；docs/adr/0018-workspace-tenancy.md D15）。
 * 失效以使用者為單位時清掉他在所有範圍的項目，所以另外維護 使用者 → key 的索引。
 */
@Injectable()
export class PermissionCacheService {
  private readonly store = new Map<string, Entry>();
  private readonly keysByUser = new Map<string, Set<string>>();
  private readonly ttl: number;

  constructor(config: ConfigService<Env, true>) {
    this.ttl = config.get('PERMISSION_CACHE_TTL', { infer: true }) * 1000;
  }

  /** `workspaceId` 不帶是平台範圍。 */
  get(userId: string, workspaceId?: string): PermissionSet | undefined {
    const key = keyOf(userId, workspaceId);
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.delete(key, userId);
      return undefined;
    }
    return entry.value;
  }

  set(userId: string, value: PermissionSet, workspaceId?: string): void {
    const key = keyOf(userId, workspaceId);
    if (this.store.size >= MAX_ENTRIES && !this.store.has(key)) {
      const oldest = this.store.keys().next();
      if (!oldest.done) this.delete(oldest.value, userOf(oldest.value));
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttl });
    const keys = this.keysByUser.get(userId) ?? new Set<string>();
    keys.add(key);
    this.keysByUser.set(userId, keys);
  }

  /** 這個使用者在所有範圍的項目。 */
  invalidate(userId: string): void {
    for (const key of this.keysByUser.get(userId) ?? []) this.store.delete(key);
    this.keysByUser.delete(userId);
  }

  invalidateMany(userIds: readonly string[]): void {
    for (const id of userIds) this.invalidate(id);
  }

  /** 這個工作區所有人的項目（工作區刪除時）。 */
  invalidateWorkspace(workspaceId: string): void {
    const suffix = `|${workspaceId}`;
    for (const key of this.store.keys()) {
      if (key.endsWith(suffix)) this.delete(key, userOf(key));
    }
  }

  invalidateAll(): void {
    this.store.clear();
    this.keysByUser.clear();
  }

  get size(): number {
    return this.store.size;
  }

  private delete(key: string, userId: string): void {
    this.store.delete(key);
    const keys = this.keysByUser.get(userId);
    keys?.delete(key);
    if (keys?.size === 0) this.keysByUser.delete(userId);
  }
}

function keyOf(userId: string, workspaceId: string | undefined): string {
  return `${userId}|${workspaceId ?? PLATFORM_SCOPE}`;
}

function userOf(key: string): string {
  return key.slice(0, key.indexOf('|'));
}
