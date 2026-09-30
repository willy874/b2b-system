import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { auditLogs, roles } from '@/db/schema';

import type { TestDatabase } from './db';
import { createTestDatabase, expectDbError, truncateAll } from './db';

let db: TestDatabase;
let close: () => Promise<void>;

describe('DB 層的不變條件（docs/architecture/backend/02-database.md §3）', () => {
  beforeAll(async () => {
    const created = createTestDatabase();
    db = created.db;
    close = async () => created.client.end();
    await truncateAll(db);
  });

  afterAll(async () => {
    await close();
  });

  describe('I7 系統角色保護 trigger', () => {
    it('刪除系統角色會被 trigger 擋下', async () => {
      const [role] = await db
        .insert(roles)
        .values({ slug: 'trigger-system', name: 'Trigger System', isSystem: true })
        .returning();
      await expectDbError(db.delete(roles).where(eq(roles.id, role!.id)), /ROLE_SYSTEM_PROTECTED/);
    });

    it('改系統角色的 slug 會被擋下', async () => {
      const [role] = await db
        .insert(roles)
        .values({ slug: 'trigger-rename', name: 'Trigger Rename', isSystem: true })
        .returning();
      await expectDbError(
        db.update(roles).set({ slug: 'renamed' }).where(eq(roles.id, role!.id)),
        /ROLE_SYSTEM_PROTECTED/,
      );
    });

    it('把 is_system 改掉也會被擋下', async () => {
      const [role] = await db
        .insert(roles)
        .values({ slug: 'trigger-flag', name: 'Trigger Flag', isSystem: true })
        .returning();
      await expectDbError(
        db.update(roles).set({ isSystem: false }).where(eq(roles.id, role!.id)),
        /ROLE_SYSTEM_PROTECTED/,
      );
    });

    it('軟刪除系統角色（設定 deleted_at）也會被擋下（docs/issues/03-edge-cases.md EDGE-25）', async () => {
      const [role] = await db
        .insert(roles)
        .values({ slug: 'trigger-soft', name: 'Trigger Soft', isSystem: true })
        .returning();
      await expectDbError(
        db.update(roles).set({ deletedAt: new Date() }).where(eq(roles.id, role!.id)),
        /ROLE_SYSTEM_PROTECTED/,
      );
    });

    it('系統角色的顯示名稱可以改（docs/rbac/01-domain-model.md §5）', async () => {
      const [role] = await db
        .insert(roles)
        .values({ slug: 'trigger-display', name: 'Trigger Display', isSystem: true })
        .returning();
      const [updated] = await db
        .update(roles)
        .set({ name: 'Trigger Display 2', description: '改過' })
        .where(eq(roles.id, role!.id))
        .returning();
      expect(updated?.name).toBe('Trigger Display 2');
    });

    it('非系統角色可以正常改名與刪除', async () => {
      const [role] = await db
        .insert(roles)
        .values({ slug: 'trigger-custom', name: 'Trigger Custom', isSystem: false })
        .returning();
      await db.update(roles).set({ name: 'Renamed' }).where(eq(roles.id, role!.id));
      await db.delete(roles).where(eq(roles.id, role!.id));
      const rows = await db.select().from(roles).where(eq(roles.id, role!.id));
      expect(rows).toHaveLength(0);
    });

    it('updated_at trigger 會自動更新', async () => {
      const [role] = await db
        .insert(roles)
        .values({ slug: 'trigger-touch', name: 'Trigger Touch' })
        .returning();
      await new Promise((resolve) => setTimeout(resolve, 10));
      const [updated] = await db
        .update(roles)
        .set({ name: 'Touched' })
        .where(eq(roles.id, role!.id))
        .returning();
      expect(updated!.updatedAt.getTime()).toBeGreaterThan(role!.updatedAt.getTime());
    });
  });

  describe('I3 角色名稱唯一（不分大小寫，docs/issues/03-edge-cases.md EDGE-21）', () => {
    it('只差大小寫的名稱不能並存', async () => {
      await db.insert(roles).values({ slug: 'case-a', name: 'Case Role' });
      await expectDbError(
        db.insert(roles).values({ slug: 'case-b', name: 'case ROLE' }),
        /roles_name_key/,
      );
    });

    it('已軟刪除的角色不佔用名稱', async () => {
      await db.insert(roles).values({ slug: 'gone-a', name: 'Gone Role', deletedAt: new Date() });
      await db.insert(roles).values({ slug: 'gone-b', name: 'GONE ROLE' });
      const rows = await db
        .select()
        .from(roles)
        .where(sql`lower(${roles.name}) = 'gone role'`);
      expect(rows).toHaveLength(2);
    });
  });

  describe('I12 稽核不可變 trigger', () => {
    it('UPDATE 會被擋下', async () => {
      const [row] = await db
        .insert(auditLogs)
        .values({
          actorEmail: 'system',
          action: 'test.immutable',
          resourceType: 'test',
          result: 'success',
        })
        .returning();
      await expectDbError(
        db.update(auditLogs).set({ action: 'tampered' }).where(eq(auditLogs.id, row!.id)),
        /AUDIT_LOG_IMMUTABLE/,
      );
    });

    it('DELETE 會被擋下', async () => {
      const [row] = await db
        .insert(auditLogs)
        .values({
          actorEmail: 'system',
          action: 'test.immutable.delete',
          resourceType: 'test',
          result: 'success',
        })
        .returning();
      await expectDbError(
        db.delete(auditLogs).where(eq(auditLogs.id, row!.id)),
        /AUDIT_LOG_IMMUTABLE/,
      );
    });
  });

  describe('I2 permissions.key 格式 CHECK', () => {
    it('key 與 resource:action 不一致時被 DB 擋下', async () => {
      await expectDbError(
        db.execute(
          sql`INSERT INTO permissions (key, resource, action, name_i18n_key) VALUES ('wrong:key', 'role', 'update', 'x')`,
        ),
        /permissions_key_format/,
      );
    });

    it('一致時可以寫入', async () => {
      await db.execute(
        sql`INSERT INTO permissions (key, resource, action, name_i18n_key) VALUES ('widget:read', 'widget', 'read', 'permission.widget.read')`,
      );
      const [row] = await db.execute<{ total: number }>(
        sql`select count(*)::int as total from permissions where key = 'widget:read'`,
      );
      expect(Number(row?.total)).toBe(1);
    });
  });
});
