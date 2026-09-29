import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { ObjectStorage } from '@/core/storage';
import { rolePermissions, permissions, userRoles, users, workspaceMemberRoles } from '@/db/schema';

import type { TestDatabase } from './db';
import { createTestDatabase, expectDbError, truncateAll } from './db';
import { InMemoryObjectStorage } from './in-memory-object-storage';
import { assignRoles, defaultWorkspaceId, roleIdOf as roleIdIn, workspacePath } from './workspace';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;

const SUPER_ADMIN = { email: 'ws-root@example.com', password: 'RootPassword!2026' };
/** 平台管理員（admin），不是任何工作區的成員 */
const PLATFORM_ADMIN = { email: 'ws-platform@example.com', password: 'PlatformPassword!2026' };
/** 預設工作區的工作區管理員 */
const WS_ADMIN = { email: 'ws-admin@example.com', password: 'WsAdminPassword!2026' };
/** 預設工作區的一般成員 */
const MEMBER = { email: 'ws-member@example.com', password: 'MemberPassword!2026' };
/** 不屬於預設工作區的人 */
const OUTSIDER = { email: 'ws-outsider@example.com', password: 'OutsiderPassword!2026' };

let defaultWs = '';
const ids: Record<string, string> = {};

const tokenCache = new Map<string, string>();
async function login(credentials: { email: string; password: string }): Promise<string> {
  const cached = tokenCache.get(credentials.email);
  if (cached) return cached;
  const response = await request(http).post('/auth/login').send(credentials).expect(200);
  const token = (response.body as { data: { accessToken: string } }).data.accessToken;
  tokenCache.set(credentials.email, token);
  return token;
}

function api(token: string) {
  const auth = (req: request.Test) => req.set('authorization', `Bearer ${token}`);
  return {
    get: (path: string) => auth(request(http).get(path)),
    post: (path: string, body: object) => auth(request(http).post(path)).send(body),
    put: (path: string, body: object) => auth(request(http).put(path)).send(body),
    patch: (path: string, body: object) => auth(request(http).patch(path)).send(body),
    delete: (path: string) => auth(request(http).delete(path)),
  };
}

function errorCode(response: request.Response): string | undefined {
  return (response.body as { error?: { code?: string } }).error?.code;
}

async function createActiveUser(
  credentials: { email: string; password: string },
  roleSlugs: string[],
  workspaceId?: string,
): Promise<string> {
  const { hashPassword } = await import('@/modules/auth/password');
  const [user] = await db
    .insert(users)
    .values({
      email: credentials.email,
      displayName: credentials.email,
      passwordHash: await hashPassword(credentials.password),
      status: 'active',
    })
    .returning();
  if (!user) throw new Error('建立使用者失敗');
  const roleIds = await Promise.all(roleSlugs.map((slug) => roleIdIn(db, slug)));
  await assignRoles(db, user.id, roleIds, workspaceId);
  return user.id;
}

describe('工作區（docs/adr/0018-workspace-tenancy.md）', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = inject('databaseUrl');
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN.email;
    process.env.SUPER_ADMIN_PASSWORD = SUPER_ADMIN.password;

    const created = createTestDatabase();
    db = created.db;
    closeDb = async () => created.client.end();
    await truncateAll(db);
    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);
    defaultWs = await defaultWorkspaceId(db);

    ids.platformAdmin = await createActiveUser(PLATFORM_ADMIN, ['admin']);
    ids.wsAdmin = await createActiveUser(WS_ADMIN, ['member', 'workspace-admin'], defaultWs);
    ids.member = await createActiveUser(MEMBER, ['member', 'workspace-member'], defaultWs);
    ids.outsider = await createActiveUser(OUTSIDER, ['member']);

    const { AppModule } = await import('@/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ObjectStorage)
      .useValue(new InMemoryObjectStorage())
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    http = app.getHttpServer() as App;
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  describe('進入工作區（D9）', () => {
    it('成員：/me 回傳工作區範圍的權限鍵', async () => {
      const response = await api(await login(MEMBER))
        .get(`${workspacePath(defaultWs)}/me`)
        .expect(200);
      const body = response.body as {
        data: { workspace: { slug: string; isMember: boolean }; permissions: string[] };
      };
      expect(body.data.workspace).toMatchObject({ slug: 'default', isMember: true });
      expect(body.data.permissions.toSorted()).toEqual(['file:access', 'workspaceMember:read']);
    });

    it('不是成員 → 404 WORKSPACE_NOT_FOUND（與不存在的工作區無法分辨）', async () => {
      const outsider = await login(OUTSIDER);
      const notMember = await api(outsider)
        .get(`${workspacePath(defaultWs)}/files`)
        .expect(404);
      expect(errorCode(notMember)).toBe('WORKSPACE_NOT_FOUND');
      const missing = await api(outsider)
        .get(`${workspacePath('00000000-0000-4000-8000-000000000000')}/files`)
        .expect(404);
      expect(errorCode(missing)).toBe('WORKSPACE_NOT_FOUND');
      await api(outsider).get('/workspaces/not-a-uuid/files').expect(404);
    });

    it('平台管理員看不到工作區裡的內容（D5）', async () => {
      const admin = await login(PLATFORM_ADMIN);
      const response = await api(admin)
        .get(`${workspacePath(defaultWs)}/files`)
        .expect(404);
      expect(errorCode(response)).toBe('WORKSPACE_NOT_FOUND');
      // 但看得到工作區本身與管理員
      const detail = await api(admin).get(`/workspaces/${defaultWs}`).expect(200);
      expect(
        (detail.body as { data: { admins: { email: string }[] } }).data.admins.map((a) => a.email),
      ).toEqual([WS_ADMIN.email]);
    });

    it('super-admin 不是成員也進得去（D5）', async () => {
      const root = await login(SUPER_ADMIN);
      await api(root)
        .get(`${workspacePath(defaultWs)}/files`)
        .expect(200);
      const mine = await api(root).get('/workspaces/mine').expect(200);
      expect(
        (mine.body as { data: { items: { slug: string; isMember: boolean }[] } }).data.items,
      ).toEqual([expect.objectContaining({ slug: 'default', isMember: false })]);
    });

    it('/workspaces/mine 只列成員的工作區', async () => {
      const member = await api(await login(MEMBER))
        .get('/workspaces/mine')
        .expect(200);
      expect((member.body as { data: { items: unknown[] } }).data.items).toHaveLength(1);
      const outsider = await api(await login(OUTSIDER))
        .get('/workspaces/mine')
        .expect(200);
      expect((outsider.body as { data: { items: unknown[] } }).data.items).toEqual([]);
    });
  });

  describe('隔離（D10）', () => {
    it('A 工作區的檔案，帶 B 工作區的前綴存取 → 404', async () => {
      const platform = await login(PLATFORM_ADMIN);
      // 平台管理員建立 B，並把 MEMBER 指定為 B 的管理員
      const created = await api(platform)
        .post('/workspaces', { name: '隔離測試', slug: 'isolation-b', adminUserId: ids.member })
        .expect(201);
      const other = (created.body as { data: { id: string } }).data.id;

      const wsAdmin = await login(WS_ADMIN);
      const folder = await api(wsAdmin)
        .post(`${workspacePath(defaultWs)}/file-folders`, { name: '只在預設', parentId: null })
        .expect(201);
      const folderId = (folder.body as { data: { id: string } }).data.id;

      // MEMBER 是 B 的管理員（B 的全域 file:*），但資料夾在預設工作區
      const member = await login(MEMBER);
      await api(member)
        .patch(`${workspacePath(other)}/file-folders/${folderId}`, { name: 'hacked' })
        .expect(404);
      await api(member)
        .get(`${workspacePath(other)}/files?folderId=${folderId}`)
        .expect(404);
      await api(member)
        .post(`${workspacePath(other)}/file-folders`, { name: 'x', parentId: folderId })
        .expect(404);

      // B 的資料夾樹是獨立的：自己的系統資料夾
      const list = await api(member)
        .get(`${workspacePath(other)}/file-folders`)
        .expect(200);
      const items = (list.body as { data: { items: { id: string; kind: string }[] } }).data.items;
      expect(items.map((item) => item.id)).not.toContain(folderId);
      await expect
        .poll(async () => {
          const again = await api(member)
            .get(`${workspacePath(other)}/file-folders`)
            .expect(200);
          return (again.body as { data: { items: { kind: string }[] } }).data.items
            .map((item) => item.kind)
            .toSorted();
        })
        .toEqual(['personal', 'privateRoot', 'shared']);
    });
  });

  describe('成員管理（D11、D12）', () => {
    it('工作區管理員指派工作區角色；一般成員不能（403）', async () => {
      const newcomer = await createActiveUser(
        { email: 'ws-newcomer@example.com', password: 'NewcomerPassword!2026' },
        [],
        defaultWs,
      );
      const viewer = await roleIdIn(db, 'workspace-viewer');
      const denied = await api(await login(MEMBER))
        .put(`${workspacePath(defaultWs)}/members/${newcomer}/roles`, { roleIds: [viewer] })
        .expect(403);
      expect(errorCode(denied)).toBe('AUTHZ_FORBIDDEN');

      const response = await api(await login(WS_ADMIN))
        .put(`${workspacePath(defaultWs)}/members/${newcomer}/roles`, { roleIds: [viewer] })
        .expect(200);
      expect(
        (response.body as { data: { roles: { slug: string }[] } }).data.roles.map((r) => r.slug),
      ).toEqual(['workspace-viewer']);
    });

    it('全域角色不能指派在工作區裡；工作區角色不能指派成全域角色（ROLE_SCOPE_MISMATCH）', async () => {
      const wsAdmin = await login(WS_ADMIN);
      const scoped = await api(wsAdmin)
        .put(`${workspacePath(defaultWs)}/members/${ids.member}/roles`, {
          roleIds: [await roleIdIn(db, 'member')],
        })
        .expect(422);
      expect(errorCode(scoped)).toBe('ROLE_SCOPE_MISMATCH');

      const root = await login(SUPER_ADMIN);
      const platform = await api(root)
        .put(`/users/${ids.outsider}/roles`, { roleIds: [await roleIdIn(db, 'workspace-admin')] })
        .expect(422);
      expect(errorCode(platform)).toBe('ROLE_SCOPE_MISMATCH');
    });

    it('反提權：指派超過自己在這個工作區的權限 → AUTHZ_ESCALATION', async () => {
      // 只有 assignRole 的成員（沒有 file:*）不能指派 workspace-admin
      const limitedRole = await api(await login(SUPER_ADMIN))
        .post('/roles', {
          name: '只能指派',
          scope: 'workspace',
          permissionKeys: ['workspaceMember:read', 'workspaceMember:assignRole'],
        })
        .expect(201);
      const limited = await createActiveUser(
        { email: 'ws-limited@example.com', password: 'LimitedPassword!2026' },
        [],
        defaultWs,
      );
      await db.insert(workspaceMemberRoles).values({
        workspaceId: defaultWs,
        userId: limited,
        roleId: (limitedRole.body as { data: { id: string } }).data.id,
      });
      const response = await api(
        await login({ email: 'ws-limited@example.com', password: 'LimitedPassword!2026' }),
      )
        .put(`${workspacePath(defaultWs)}/members/${ids.member}/roles`, {
          roleIds: [await roleIdIn(db, 'workspace-admin')],
        })
        .expect(403);
      expect(errorCode(response)).toBe('AUTHZ_ESCALATION');
    });

    it('不能改自己；不能移除最後一位管理員（WORKSPACE_LAST_ADMIN）', async () => {
      const wsAdmin = await login(WS_ADMIN);
      const self = await api(wsAdmin)
        .delete(`${workspacePath(defaultWs)}/members/${ids.wsAdmin}`)
        .expect(403);
      expect(errorCode(self)).toBe('AUTHZ_SELF_MODIFY');

      // super-admin 不是成員：移除唯一持有 assignRole 的人會留下沒人能管理的工作區
      // （ws-limited 也有 assignRole：先拿掉它）
      const root = await login(SUPER_ADMIN);
      const limited = await db
        .select()
        .from(users)
        .where(eq(users.email, 'ws-limited@example.com'));
      await api(root)
        .delete(`${workspacePath(defaultWs)}/members/${limited[0]?.id}`)
        .expect(204);
      const last = await api(root)
        .delete(`${workspacePath(defaultWs)}/members/${ids.wsAdmin}`)
        .expect(409);
      expect(errorCode(last)).toBe('WORKSPACE_LAST_ADMIN');
    });

    it('移除成員 → 立刻進不去', async () => {
      const leaver = await createActiveUser(
        { email: 'ws-leaver@example.com', password: 'LeaverPassword!2026' },
        ['workspace-member'],
        defaultWs,
      );
      const token = await login({
        email: 'ws-leaver@example.com',
        password: 'LeaverPassword!2026',
      });
      await api(token)
        .get(`${workspacePath(defaultWs)}/file-folders`)
        .expect(200);
      await api(await login(WS_ADMIN))
        .delete(`${workspacePath(defaultWs)}/members/${leaver}`)
        .expect(204);
      await api(token)
        .get(`${workspacePath(defaultWs)}/file-folders`)
        .expect(404);
    });
  });

  describe('平台的工作區管理（D5、D13）', () => {
    it('建立工作區：第一位管理員取得 workspace-admin；slug 重複 → 409', async () => {
      const admin = await login(PLATFORM_ADMIN);
      const response = await api(admin)
        .post('/workspaces', { name: '美術外包', adminUserId: ids.wsAdmin })
        .expect(201);
      const body = response.body as {
        data: { id: string; slug: string; admins: { id: string }[]; memberCount: number };
      };
      expect(body.data).toMatchObject({ slug: 'workspace', memberCount: 1 });
      expect(body.data.admins.map((a) => a.id)).toEqual([ids.wsAdmin]);

      const duplicate = await api(admin)
        .post('/workspaces', { name: 'x', slug: 'default', adminUserId: ids.wsAdmin })
        .expect(409);
      expect(errorCode(duplicate)).toBe('WORKSPACE_SLUG_DUPLICATE');
    });

    it('刪除工作區 → 成員立刻進不去', async () => {
      const admin = await login(PLATFORM_ADMIN);
      const created = await api(admin)
        .post('/workspaces', { name: '要刪的', slug: 'to-delete', adminUserId: ids.member })
        .expect(201);
      const id = (created.body as { data: { id: string } }).data.id;
      const member = await login(MEMBER);
      await api(member)
        .get(`${workspacePath(id)}/me`)
        .expect(200);
      await api(admin).delete(`/workspaces/${id}`).expect(204);
      await api(member)
        .get(`${workspacePath(id)}/me`)
        .expect(404);
    });

    it('工作區角色的權限鍵在角色定義上不受反提權限制（D3）；範圍不符 → ROLE_SCOPE_MISMATCH', async () => {
      const admin = await login(PLATFORM_ADMIN);
      await api(admin)
        .post('/roles', { name: '美術', scope: 'workspace', permissionKeys: ['file:read'] })
        .expect(201);
      const mixed = await api(admin)
        .post('/roles', { name: '混合', scope: 'workspace', permissionKeys: ['user:read'] })
        .expect(422);
      expect(errorCode(mixed)).toBe('ROLE_SCOPE_MISMATCH');
    });
  });

  describe('資料庫不變條件（D3）', () => {
    it('工作區角色寫不進 user_roles；全域角色寫不進 workspace_member_roles', async () => {
      await expectDbError(
        db
          .insert(userRoles)
          .values({ userId: ids.outsider!, roleId: await roleIdIn(db, 'workspace-admin') }),
        /ROLE_SCOPE_MISMATCH/,
      );
      await expectDbError(
        db.insert(workspaceMemberRoles).values({
          workspaceId: defaultWs,
          userId: ids.member!,
          roleId: await roleIdIn(db, 'admin'),
        }),
        /ROLE_SCOPE_MISMATCH/,
      );
    });

    it('角色只能含同範圍的權限鍵', async () => {
      const [fileRead] = await db
        .select()
        .from(permissions)
        .where(eq(permissions.key, 'file:read'));
      await expectDbError(
        db
          .insert(rolePermissions)
          .values({ roleId: await roleIdIn(db, 'admin'), permissionId: fileRead!.id }),
        /ROLE_SCOPE_MISMATCH/,
      );
    });
  });
});
