import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { PermissionKey } from '@/common/types';

import type { Env } from '../config';

export interface PermissionSet {
  permissions: Set<PermissionKey>;
  isSuperAdmin: boolean;
}

interface Entry {
  value: PermissionSet;
  expiresAt: number;
}

/** 異常情況下的上限，避免無限成長（docs/backend/05-rbac.md §5.3）。 */
const MAX_ENTRIES = 10_000;

@Injectable()
export class PermissionCacheService {
  private readonly store = new Map<string, Entry>();
  private readonly ttl: number;

  constructor(config: ConfigService<Env, true>) {
    this.ttl = config.get('PERMISSION_CACHE_TTL', { infer: true }) * 1000;
  }

  get(userId: string): PermissionSet | undefined {
    const entry = this.store.get(userId);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(userId);
      return undefined;
    }
    return entry.value;
  }

  set(userId: string, value: PermissionSet): void {
    if (this.store.size >= MAX_ENTRIES && !this.store.has(userId)) {
      const oldest = this.store.keys().next();
      if (!oldest.done) this.store.delete(oldest.value);
    }
    this.store.set(userId, { value, expiresAt: Date.now() + this.ttl });
  }

  invalidate(userId: string): void {
    this.store.delete(userId);
  }

  invalidateMany(userIds: readonly string[]): void {
    for (const id of userIds) this.store.delete(id);
  }

  invalidateAll(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
