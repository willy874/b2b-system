import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  EVERYONE_SUBJECT_ID,
  fileFolders,
  permissions,
  relationTuples,
  resourceGrants,
  rolePermissions,
  roles,
  userRoles,
  users,
} from '@/db/schema';
import { seedPermissions } from '@/db/seeds';

import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';

let db: TestDatabase;
let close: () => Promise<void>;

/** relation_tuples 的內容，每條寫成 `物件#關係@主體`（過期時間另外附上）。 */
async function tuples(): Promise<string[]> {
  const rows = await db.select().from(relationTuples);
  return rows
    .map((row) => {
      const subject = row.subjectRelation
        ? `${row.subjectType}:${row.subjectId}#${row.subjectRelation}`
        : `${row.subjectType}:${row.subjectId}`;
      const expiry = row.expiresAt ? ` (~${row.expiresAt.toISOString()})` : '';
      return `${row.objectType}:${row.objectId}#${row.relation}@${subject}${expiry}`;
    })
    .toSorted();
}

/**
 * 由三張舊表推導出「應該有的」tuple（與 migration 0008 的對照表相同），與實際內容比較：
 * 任何一種寫入之後兩者都要一致。
 */
async function expectMirrored(): Promise<void> {
  const expected = await db.execute<{ tuple: string }>(sql`
    SELECT 'role:' || role_id || '#holder@user:' || user_id AS tuple FROM user_roles
    UNION ALL
    SELECT 'tenant:self#' || p.key || '@role:' || rp.role_id || '#holder'
    FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
    UNION ALL
    SELECT g.resource_type || ':' || g.resource_id || '#' || g.level || '@' ||
      CASE g.subject_type WHEN 'role' THEN 'role:' || g.subject_id || '#holder'
                          WHEN 'user' THEN 'user:' || g.subject_id
                          ELSE 'user:*' END ||
      COALESCE(' (~' || to_char(g.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || ')', '')
    FROM resource_grants g
    UNION ALL
    SELECT 'tenant:self#superAdmin@role:' || id || '#holder' FROM roles WHERE slug = 'super-admin'
  `);
  expect(await tuples()).toEqual(expected.map((row) => row.tuple).toSorted());
}

async function createUser(email: string): Promise<string> {
  const [user] = await db.insert(users).values({ email, displayName: email }).returning();
  return user!.id;
}

async function createRole(slug: string): Promise<string> {
  const [role] = await db.insert(roles).values({ slug, name: slug }).returning();
  return role!.id;
}

async function permissionId(key: string): Promise<string> {
  const [row] = await db.select().from(permissions).where(eq(permissions.key, key));
  return row!.id;
}

async function createFolder(name: string): Promise<string> {
  const [folder] = await db.insert(fileFolders).values({ name }).returning();
  return folder!.id;
}

describe('relation_tuples 與舊表的同步（migration 0008，docs/adr/0024-relationship-based-access-control.md G1）', () => {
  beforeAll(async () => {
    const created = createTestDatabase();
    db = created.db;
    close = async () => created.client.end();
  });

  beforeEach(async () => {
    await truncateAll(db);
    await seedPermissions(db as never);
  });

  afterAll(async () => {
    await close();
  });

  it('指派與移除角色 → role:<id>#holder@user:<id>', async () => {
    const [alice, editor] = [await createUser('alice@x'), await createRole('editor')];
    await db.insert(userRoles).values({ userId: alice, roleId: editor });
    expect(await tuples()).toEqual([`role:${editor}#holder@user:${alice}`]);
    await db.delete(userRoles).where(eq(userRoles.userId, alice));
    expect(await tuples()).toEqual([]);
  });

  it('角色的權限增刪 → tenant:self#<key>@role:<id>#holder', async () => {
    const editor = await createRole('editor');
    await db.insert(rolePermissions).values([
      { roleId: editor, permissionId: await permissionId('file:read') },
      { roleId: editor, permissionId: await permissionId('file:update') },
    ]);
    await expectMirrored();
    await db
      .delete(rolePermissions)
      .where(
        and(
          eq(rolePermissions.roleId, editor),
          eq(rolePermissions.permissionId, await permissionId('file:update')),
        ),
      );
    expect(await tuples()).toEqual([`tenant:self#file:read@role:${editor}#holder`]);
  });

  it('重複插入（onConflictDoNothing）不會產生重複的邊', async () => {
    const [alice, editor] = [await createUser('alice@x'), await createRole('editor')];
    await db.insert(userRoles).values({ userId: alice, roleId: editor });
    await db.insert(userRoles).values({ userId: alice, roleId: editor }).onConflictDoNothing();
    await expectMirrored();
  });

  it('super-admin 角色建立時補上 tenant:self#superAdmin', async () => {
    const id = await createRole('super-admin');
    expect(await tuples()).toEqual([`tenant:self#superAdmin@role:${id}#holder`]);
  });

  it('資料夾授權：角色、使用者、everyone 三種對象', async () => {
    const [folder, alice, editor] = [
      await createFolder('art'),
      await createUser('alice@x'),
      await createRole('editor'),
    ];
    await db.insert(resourceGrants).values([
      {
        resourceType: 'fileFolder',
        resourceId: folder,
        subjectType: 'role',
        subjectId: editor,
        level: 'editor',
      },
      {
        resourceType: 'fileFolder',
        resourceId: folder,
        subjectType: 'user',
        subjectId: alice,
        level: 'viewer',
      },
      {
        resourceType: 'fileFolder',
        resourceId: folder,
        subjectType: 'everyone',
        subjectId: EVERYONE_SUBJECT_ID,
        level: 'contributor',
      },
    ]);
    expect(await tuples()).toEqual(
      [
        `fileFolder:${folder}#editor@role:${editor}#holder`,
        `fileFolder:${folder}#viewer@user:${alice}`,
        `fileFolder:${folder}#contributor@user:*`,
      ].toSorted(),
    );
  });

  it('upsert 改等級與過期時間：舊的邊換成新的', async () => {
    const [folder, alice] = [await createFolder('art'), await createUser('alice@x')];
    const key = {
      resourceType: 'fileFolder' as const,
      resourceId: folder,
      subjectType: 'user' as const,
      subjectId: alice,
    };
    await db.insert(resourceGrants).values({ ...key, level: 'viewer' });
    const expiresAt = new Date('2030-01-01T00:00:00.000Z');
    await db
      .insert(resourceGrants)
      .values({ ...key, level: 'manager', expiresAt })
      .onConflictDoUpdate({
        target: [
          resourceGrants.resourceType,
          resourceGrants.resourceId,
          resourceGrants.subjectType,
          resourceGrants.subjectId,
        ],
        set: { level: 'manager', expiresAt },
      });
    expect(await tuples()).toEqual([
      `fileFolder:${folder}#manager@user:${alice} (~2030-01-01T00:00:00.000Z)`,
    ]);
    await db.delete(resourceGrants).where(eq(resourceGrants.resourceId, folder));
    expect(await tuples()).toEqual([]);
  });

  it('刪除角色（hard delete 的 cascade）一併移除持有者與權限的邊', async () => {
    const [alice, editor] = [await createUser('alice@x'), await createRole('editor')];
    await db.insert(userRoles).values({ userId: alice, roleId: editor });
    await db
      .insert(rolePermissions)
      .values({ roleId: editor, permissionId: await permissionId('file:read') });
    await db.delete(roles).where(eq(roles.id, editor));
    expect(await tuples()).toEqual([]);
  });

  it('混合的寫入之後，relation_tuples 與舊表推導的結果一致', async () => {
    const [alice, bob, editor, viewer, folder] = [
      await createUser('alice@x'),
      await createUser('bob@x'),
      await createRole('editor'),
      await createRole('viewer'),
      await createFolder('art'),
    ];
    await createRole('super-admin');
    await db.insert(userRoles).values([
      { userId: alice, roleId: editor },
      { userId: bob, roleId: viewer },
      { userId: bob, roleId: editor },
    ]);
    await db.insert(rolePermissions).values([
      { roleId: editor, permissionId: await permissionId('file:create') },
      { roleId: viewer, permissionId: await permissionId('file:access') },
    ]);
    await db.insert(resourceGrants).values({
      resourceType: 'fileFolder',
      resourceId: folder,
      subjectType: 'role',
      subjectId: viewer,
      level: 'viewer',
    });
    await db.delete(userRoles).where(and(eq(userRoles.userId, bob), eq(userRoles.roleId, editor)));
    await expectMirrored();
  });
});
