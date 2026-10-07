import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { relationTuples, roleHolderTuple, rolePermissionTuple, roles, users } from '@/db/schema';

import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;

const SUPER_ADMIN = { email: 'root@example.com', password: 'Quiet-Harbor-Lantern-26' };
const ADMIN = { email: 'explain-admin@example.com', password: 'AdminPassword!2026' };
const ALICE = { email: 'alice@example.com', password: 'AlicePassword!2026' };
const BOB = { email: 'bob@example.com', password: 'BobPassword!2026' };

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

async function createActiveUser(
  credentials: { email: string; password: string },
  roleSlug?: string,
): Promise<string> {
  const { hashPassword } = await import('@/modules/credential/password');
  const [user] = await db
    .insert(users)
    .values({
      email: credentials.email,
      displayName: credentials.email.split('@')[0]!,
      passwordHash: await hashPassword(credentials.password),
      status: 'active',
    })
    .returning();
  if (roleSlug) {
    const [role] = await db.select().from(roles).where(eq(roles.slug, roleSlug));
    await db.insert(relationTuples).values(roleHolderTuple(role!.id, user!.id));
  }
  return user!.id;
}

async function as(credentials: { email: string; password: string }) {
  const token = await login(credentials);
  const auth = (req: request.Test) => req.set('authorization', `Bearer ${token}`);
  return {
    get: (path: string) => auth(request(http).get(path)),
    post: (path: string, body?: object) => auth(request(http).post(path)).send(body),
    patch: (path: string, body: object) => auth(request(http).patch(path)).send(body),
    put: (path: string, body: object) => auth(request(http).put(path)).send(body),
  };
}

interface Node {
  type: string;
  id: string | null;
  relation: string;
  name: string | null;
  hidden: boolean;
}

/** 路徑的精簡表示：`型別:名稱#關係`，讀不到的節點 `型別:?`。 */
const brief = (path: Node[] | null) =>
  path?.map((node) =>
    node.hidden
      ? `${node.type}:?${node.relation ? `#${node.relation}` : ''}`
      : `${node.type}:${node.name ?? node.id}${node.relation ? `#${node.relation}` : ''}`,
  ) ?? null;

describe('授權說明（docs/architecture/iam/01-model.md §9 G4b、D14）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN.email;
    process.env.SUPER_ADMIN_PASSWORD = SUPER_ADMIN.password;
    process.env.PERMISSION_CACHE_TTL = '60';

    const created = createTestDatabase();
    db = created.db;
    closeDb = async () => created.client.end();
    await truncateAll(db);
    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);

    const [logReader] = await db
      .insert(roles)
      .values({ slug: 'log-reader', name: '日誌閱讀', isSystem: false })
      .returning();
    ids.logReader = logReader!.id;
    await db.insert(relationTuples).values(rolePermissionTuple(ids.logReader, 'auditLog:read'));

    ids.admin = await createActiveUser(ADMIN, 'admin');
    ids.alice = await createActiveUser(ALICE, 'member');
    ids.bob = await createActiveUser(BOB, 'member');

    const { AppModule } = await import('@/app.module');
    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();
    http = await listenOnLoopback(app);

    // alice ∈ Design ∈ 美術；美術持有「日誌閱讀」
    const root = await as(SUPER_ADMIN);
    const art = await root.post('/groups', { name: '美術' }).expect(201);
    ids.art = art.body.data.id;
    const design = await root.post('/groups', { name: 'Design' }).expect(201);
    ids.design = design.body.data.id;
    await root
      .patch(`/groups/${ids.art}/members`, { add: [{ type: 'group', id: ids.design }], remove: [] })
      .expect(200);
    await root
      .patch(`/groups/${ids.design}/members`, {
        add: [{ type: 'user', id: ids.alice }],
        remove: [],
      })
      .expect(200);
    await root.patch(`/groups/${ids.art}/roles`, { add: [ids.logReader], remove: [] }).expect(200);

    // 資料夾「素材」授權給美術（viewer），子資料夾「角色」繼承
    const assets = await root.post('/file-folders', { name: '素材', parentId: null }).expect(201);
    ids.assets = assets.body.data.id;
    const child = await root
      .post('/file-folders', { name: '角色', parentId: ids.assets })
      .expect(201);
    ids.child = child.body.data.id;
    await root
      .put(`/file-folders/${ids.assets}/grants`, {
        subjectType: 'group',
        subjectId: ids.art,
        level: 'viewer',
      })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  describe('GET /users/:id/permission-sources', () => {
    it('查自己：每個鍵附來源；讀不到的上層群組與角色遮成型別，直接所屬的群組與角色照樣顯示', async () => {
      const response = await (await as(ALICE)).get(`/users/${ids.alice}/permission-sources`);
      expect(response.status).toBe(200);
      const data = response.body.data as {
        isSuperAdmin: boolean;
        items: Array<{ key: string; sources: Array<{ grantedKey: string; via: Node[] }> }>;
      };
      expect(data.isSuperAdmin).toBe(false);
      const auditLog = data.items.find((item) => item.key === 'auditLog:read');
      expect(auditLog?.sources.map((source) => brief(source.via))).toEqual([
        ['user:alice', 'group:Design#member', 'group:?#member', 'role:?#holder'],
      ]);
      // member 角色是直接持有的：顯示名稱
      const access = data.items.find((item) => item.key === 'file:access');
      expect(access?.sources.map((source) => brief(source.via))).toEqual([
        ['user:alice', 'role:一般成員#holder'],
      ]);
    });

    it('有 authz:explain（admin）查別人：路徑上的節點都看得到', async () => {
      const response = await (
        await as(ADMIN)
      )
        .get(`/users/${ids.alice}/permission-sources`)
        .expect(200);
      const auditLog = (
        response.body.data.items as Array<{ key: string; sources: Array<{ via: Node[] }> }>
      ).find((item) => item.key === 'auditLog:read');
      expect(brief(auditLog!.sources[0]!.via)).toEqual([
        'user:alice',
        'group:Design#member',
        'group:美術#member',
        'role:日誌閱讀#holder',
      ]);
    });

    it('依賴樹帶出的鍵標出明確授予的鍵（grantedKey）', async () => {
      const response = await (
        await as(ADMIN)
      )
        .get(`/users/${ids.admin}/permission-sources`)
        .expect(200);
      const items = response.body.data.items as Array<{
        key: string;
        sources: Array<{ grantedKey: string }>;
      }>;
      // admin 明確持有 file:delete，它帶出 file:update
      expect(
        items.find((item) => item.key === 'file:update')?.sources.map((s) => s.grantedKey),
      ).toEqual(expect.arrayContaining(['file:update', 'file:delete']));
    });

    it('沒有 authz:explain 查別人 → 403 AUTHZ_FORBIDDEN', async () => {
      const response = await (await as(BOB)).get(`/users/${ids.alice}/permission-sources`);
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('AUTHZ_FORBIDDEN');
    });

    it('super-admin：isSuperAdmin 與怎麼成為的', async () => {
      const root = await as(SUPER_ADMIN);
      const [rootUser] = await db.select().from(users).where(eq(users.email, SUPER_ADMIN.email));
      const response = await root.get(`/users/${rootUser!.id}/permission-sources`).expect(200);
      expect(response.body.data.isSuperAdmin).toBe(true);
      expect(brief(response.body.data.superAdminVia)).toEqual([
        `user:${rootUser!.displayName}`,
        'role:超級管理員#holder',
      ]);
    });
  });

  describe('GET /file-folders/:id/explain', () => {
    it('經由巢狀群組與資料夾繼承讀得到：路徑從本人出發，沒有的動作是 null', async () => {
      const response = await (
        await as(ALICE)
      )
        .get(`/file-folders/${ids.child}/explain?userId=${ids.alice}`)
        .expect(200);
      const actions = response.body.data.actions as Array<{
        action: string;
        allowed: boolean;
        path: Node[] | null;
      }>;
      const read = actions.find((item) => item.action === 'read');
      expect(read?.allowed).toBe(true);
      expect(brief(read!.path)).toEqual([
        'user:alice',
        'group:Design#member',
        'group:?#member',
        'fileFolder:素材#viewer',
        'fileFolder:角色#viewer',
        'fileFolder:角色#can_read',
      ]);
      expect(actions.filter((item) => item.allowed).map((item) => item.action)).toEqual(['read']);
      expect(actions.find((item) => item.action === 'delete')?.path).toBeNull();
    });

    it('查別人：沒有 authz:explain → 403；有 → 看得到上層群組的名稱', async () => {
      const denied = await (
        await as(BOB)
      ).get(`/file-folders/${ids.child}/explain?userId=${ids.alice}`);
      expect(denied.status).toBe(403);
      const response = await (
        await as(ADMIN)
      )
        .get(`/file-folders/${ids.child}/explain?userId=${ids.alice}`)
        .expect(200);
      const read = (response.body.data.actions as Array<{ action: string; path: Node[] }>).find(
        (item) => item.action === 'read',
      );
      expect(brief(read!.path)).toContain('group:美術#member');
    });

    it('操作者讀不到的資料夾只顯示型別（bob 查自己：私人資料夾以外都鎖住）', async () => {
      const response = await (
        await as(BOB)
      )
        .get(`/file-folders/${ids.child}/explain?userId=${ids.bob}`)
        .expect(200);
      expect(
        (response.body.data.actions as Array<{ allowed: boolean }>).every((item) => !item.allowed),
      ).toBe(true);
    });
  });
});
