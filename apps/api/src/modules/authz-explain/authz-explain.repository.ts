import { Inject, Injectable } from '@nestjs/common';
import { and, inArray } from 'drizzle-orm';

import type { Database } from '@/core/database';
import { TENANT_DB } from '@/core/database';
import { groups, isActiveGroup, isActiveRole, notDeleted, roles, users } from '@/db/schema';

/** 說明路徑上的節點名稱：只查未刪除的（已刪除的節點不會出現在解析出來的路徑上）。 */
@Injectable()
export class AuthzExplainRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  async userNames(ids: readonly string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.db
      .select({ id: users.id, name: users.displayName })
      .from(users)
      .where(and(inArray(users.id, [...ids]), notDeleted(users)));
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  async groupNames(ids: readonly string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.db
      .select({ id: groups.id, name: groups.name })
      .from(groups)
      .where(and(inArray(groups.id, [...ids]), isActiveGroup()));
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  async roleNames(ids: readonly string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.db
      .select({ id: roles.id, name: roles.name })
      .from(roles)
      .where(and(inArray(roles.id, [...ids]), isActiveRole()));
    return new Map(rows.map((row) => [row.id, row.name]));
  }
}
