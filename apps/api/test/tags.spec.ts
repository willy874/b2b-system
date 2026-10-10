import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { and, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import type { Response } from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ObjectStorage } from '@/core/storage';
import {
  auditLogs,
  fileFolders,
  files,
  relationTuples,
  resourceTags,
  roleHolderTuple,
  rolePermissionTuple,
  roles,
  tags,
  users,
} from '@/db/schema';
import { hashPassword } from '@/modules/credential/password';
import { FileImageService } from '@/modules/file/file-image.service';
import { TrashService } from '@/modules/trash/trash.service';

import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';
import { InMemoryObjectStorage } from './in-memory-object-storage';
import { inTestTenant } from './tenant';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;
const storage = new InMemoryObjectStorage();

const PASSWORD = 'TagsPassword!2026';
const ROOT = { email: 'tags-root@example.com', password: 'Quiet-Harbor-Lantern-26' };
const ADMIN = 'tags-admin@example.com';
const MEMBER = 'tags-member@example.com';
const READER = 'tags-reader@example.com';
const DAY_MS = 24 * 60 * 60 * 1000;

interface TagBody {
  id: string;
  scope: string;
  name: string;
  color: string;
  version: number;
}

interface Tagged {
  id: string;
  tags: Array<{ id: string; name: string; color: string }>;
}

function dataOf<T>(response: Response): T {
  return (response.body as { data: T }).data;
}

function errorOf(response: Response): { code: string; details?: Record<string, unknown> } {
  return (response.body as { error: { code: string; details?: Record<string, unknown> } }).error;
}

const tokens = new Map<string, string>();
async function login(email: string, password = PASSWORD): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const response = await request(http).post('/auth/login').send({ email, password }).expect(200);
  const token = dataOf<{ accessToken: string }>(response).accessToken;
  tokens.set(email, token);
  return token;
}

async function as(email: string, password = PASSWORD) {
  const token = await login(email, password);
  const auth = (req: request.Test) => req.set('authorization', `Bearer ${token}`);
  return {
    get: (path: string) => auth(request(http).get(path)),
    post: (path: string, body: object = {}) => auth(request(http).post(path)).send(body),
    put: (path: string, body: object) => auth(request(http).put(path)).send(body),
    patch: (path: string, body: object) => auth(request(http).patch(path)).send(body),
    delete: (path: string) => auth(request(http).delete(path)),
  };
}

async function createUser(email: string, roleId: string): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({
      email,
      displayName: `名稱 ${email}`,
      passwordHash: await hashPassword(PASSWORD),
      status: 'active',
    })
    .returning();
  await db.insert(relationTuples).values(roleHolderTuple(roleId, user!.id));
  return user!.id;
}

async function roleIdOf(slug: string): Promise<string> {
  const [role] = await db.select().from(roles).where(eq(roles.slug, slug));
  return role!.id;
}

const ids: Record<string, string> = {};

describe('標籤（docs/architecture/backend/18-tag.md §7）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = ROOT.email;
    process.env.SUPER_ADMIN_PASSWORD = ROOT.password;
    process.env.AUTH_RATE_LIMIT = '1000';

    const created = createTestDatabase();
    db = created.db;
    closeDb = async () => created.client.end();
    await truncateAll(db);
    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);

    const [readerRole] = await db
      .insert(roles)
      .values({ slug: 'tags-reader', name: 'tags-reader', isSystem: false })
      .returning();
    await db.insert(relationTuples).values(rolePermissionTuple(readerRole!.id, 'user:read'));
    ids.admin = await createUser(ADMIN, await roleIdOf('admin'));
    ids.member = await createUser(MEMBER, await roleIdOf('member'));
    ids.reader = await createUser(READER, readerRole!.id);

    const { AppModule } = await import('@/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ObjectStorage)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    http = await listenOnLoopback(app);
  });

  afterAll(async () => {
    await app.get(FileImageService).whenIdle();
    await app.close();
    await closeDb();
    delete process.env.AUTH_RATE_LIMIT;
  });

  describe('定義（D2～D5）', () => {
    it('admin 在兩個標籤組各建立標籤；同組同名（不分大小寫）409，不同組可以同名', async () => {
      const admin = await as(ADMIN);
      const department = dataOf<TagBody>(
        await admin.post('/tags', { scope: 'user', name: '研發部', color: 'brand' }).expect(201),
      );
      ids.department = department.id;
      expect(department).toMatchObject({
        scope: 'user',
        name: '研發部',
        color: 'brand',
        version: 1,
      });
      ids.contract = dataOf<TagBody>(
        await admin.post('/tags', { scope: 'file', name: '合約', color: 'warning' }).expect(201),
      ).id;
      ids.urgent = dataOf<TagBody>(
        await admin.post('/tags', { scope: 'file', name: '急件' }).expect(201),
      ).id;

      const duplicate = await admin.post('/tags', { scope: 'user', name: '研發部' }).expect(409);
      expect(errorOf(duplicate).code).toBe('TAG_NAME_DUPLICATE');
      await admin.post('/tags', { scope: 'file', name: '研發部' }).expect(201);
    });

    it('不認得的標籤組 404、不合法的顏色 400', async () => {
      const admin = await as(ADMIN);
      expect(
        errorOf(await admin.post('/tags', { scope: 'project', name: 'x' }).expect(404)).code,
      ).toBe('TAG_SCOPE_NOT_FOUND');
      await admin.post('/tags', { scope: 'file', name: 'x', color: '#ff0000' }).expect(400);
    });

    it('讀定義要進得了標籤組：member 讀得到檔案組、讀不到使用者組；沒有 tag:create 不能建立', async () => {
      const member = await as(MEMBER);
      const fileTags = dataOf<{ items: TagBody[] }>(
        await member.get('/tags?scope=file').expect(200),
      );
      expect(fileTags.items.map((item) => item.name)).toEqual(['合約', '急件', '研發部']);
      await member.get('/tags?scope=user').expect(403);
      await member.post('/tags', { scope: 'file', name: 'y' }).expect(403);
    });

    it('改名帶 version；舊版本 409', async () => {
      const admin = await as(ADMIN);
      const renamed = dataOf<TagBody>(
        await admin.patch(`/tags/${ids.urgent}`, { name: '急件！', version: 1 }).expect(200),
      );
      expect(renamed).toMatchObject({ name: '急件！', version: 2 });
      const stale = await admin.patch(`/tags/${ids.urgent}`, { name: 'x', version: 1 }).expect(409);
      expect(errorOf(stale)).toMatchObject({
        code: 'TAG_VERSION_CONFLICT',
        details: { current: 2 },
      });
    });
  });

  describe('使用者（D5～D8）', () => {
    it('admin 貼標籤；列表與詳情帶標籤，依標籤篩選，寫稽核', async () => {
      const admin = await as(ADMIN);
      const result = dataOf<{ tags: Array<{ id: string }> }>(
        await admin
          .put(`/tags/assignments/user/${ids.member}`, { tagIds: [ids.department] })
          .expect(200),
      );
      expect(result.tags.map((item) => item.id)).toEqual([ids.department]);

      const detail = dataOf<Tagged>(await admin.get(`/users/${ids.member}`).expect(200));
      expect(detail.tags).toEqual([{ id: ids.department, name: '研發部', color: 'brand' }]);
      const filtered = dataOf<{ items: Tagged[]; pagination: { total: number } }>(
        await admin.get(`/users?tagId=${ids.department}`).expect(200),
      );
      expect(filtered.items.map((user) => user.id)).toEqual([ids.member]);
      expect(filtered.pagination.total).toBe(1);

      const [audit] = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'tag.assign'), eq(auditLogs.resourceId, ids.member!)));
      expect(audit).toMatchObject({
        resourceType: 'user',
        resourceName: MEMBER,
        changes: { before: { tags: [] }, after: { tags: ['研發部'] } },
      });
    });

    it('PATCH 差異語意：只加減指定的標籤；已經有的再加不寫稽核', async () => {
      const admin = await as(ADMIN);
      const tagIdsOf = (response: Parameters<typeof dataOf>[0]) =>
        dataOf<{ tags: Array<{ id: string }> }>(response).tags.map((item) => item.id);
      const auditCount = async () =>
        (
          await db
            .select()
            .from(auditLogs)
            .where(and(eq(auditLogs.action, 'tag.assign'), eq(auditLogs.resourceId, ids.member!)))
        ).length;

      expect(
        tagIdsOf(
          await admin
            .patch(`/tags/assignments/user/${ids.member}`, { remove: [ids.department] })
            .expect(200),
        ),
      ).toEqual([]);
      expect(
        tagIdsOf(
          await admin
            .patch(`/tags/assignments/user/${ids.member}`, { add: [ids.department] })
            .expect(200),
        ),
      ).toEqual([ids.department]);
      const before = await auditCount();
      await admin
        .patch(`/tags/assignments/user/${ids.member}`, { add: [ids.department] })
        .expect(200);
      expect(await auditCount()).toBe(before);

      await admin.patch(`/tags/assignments/user/${ids.member}`, {}).expect(400);
    });

    it('只有 user:read 的人看得到標籤，但不能貼', async () => {
      const reader = await as(READER);
      const listed = dataOf<{ items: Tagged[] }>(await reader.get('/users?limit=100').expect(200));
      expect(listed.items.find((user) => user.id === ids.member)?.tags).toHaveLength(1);
      const denied = await reader
        .put(`/tags/assignments/user/${ids.member}`, { tagIds: [] })
        .expect(403);
      expect(errorOf(denied).code).toBe('AUTHZ_FORBIDDEN');
    });

    it('檔案組的標籤不能貼在使用者上 → TAG_NOT_FOUND', async () => {
      const admin = await as(ADMIN);
      const response = await admin
        .put(`/tags/assignments/user/${ids.member}`, { tagIds: [ids.contract] })
        .expect(404);
      expect(errorOf(response)).toMatchObject({
        code: 'TAG_NOT_FOUND',
        details: { tagIds: [ids.contract] },
      });
    });

    it('不認得的資源類型 → TAG_SCOPE_NOT_FOUND；不存在的使用者 → USER_NOT_FOUND', async () => {
      const admin = await as(ADMIN);
      await admin.put(`/tags/assignments/role/${ids.member}`, { tagIds: [] }).expect(404);
      const missing = await admin
        .put('/tags/assignments/user/00000000-0000-4000-8000-000000000000', { tagIds: [] })
        .expect(404);
      expect(errorOf(missing).code).toBe('USER_NOT_FOUND');
    });
  });

  describe('檔案與資料夾（共用 file 組）', () => {
    it('貼在檔案與資料夾上；檔案列表依標籤篩選；資料夾列表帶標籤', async () => {
      const admin = await as(ADMIN);
      const folder = dataOf<{ id: string }>(
        await admin.post('/file-folders', { name: '專案', parentId: null }).expect(201),
      );
      ids.folder = folder.id;
      for (const name of ['a.pdf', 'b.pdf']) {
        const started = await admin
          .post('/files', {
            name,
            contentType: 'application/pdf',
            size: 10,
            folderId: folder.id,
          })
          .expect(201);
        const { file, upload } = dataOf<{ file: { id: string }; upload: { url: string } }>(started);
        storage.simulateBrowserUpload(upload.url, 10);
        await admin.post(`/files/${file.id}/complete`).expect(200);
        ids[name] = file.id;
      }

      await admin
        .put(`/tags/assignments/file/${ids['a.pdf']}`, { tagIds: [ids.contract, ids.urgent] })
        .expect(200);
      await admin
        .put(`/tags/assignments/fileFolder/${ids.folder}`, { tagIds: [ids.contract] })
        .expect(200);

      const filtered = dataOf<{ items: Tagged[] }>(
        await admin.get(`/files?folderId=${ids.folder}&tagId=${ids.urgent}`).expect(200),
      );
      expect(filtered.items.map((file) => file.id)).toEqual([ids['a.pdf']]);
      expect(filtered.items[0]!.tags.map((item) => item.name)).toEqual(['合約', '急件！']);

      const folders = dataOf<{ items: Tagged[] }>(await admin.get('/file-folders').expect(200));
      expect(folders.items.find((item) => item.id === ids.folder)?.tags).toEqual([
        { id: ids.contract, name: '合約', color: 'warning' },
      ]);
    });

    it('member 只有 file:access：看不到鎖住資料夾裡的檔案，也不能貼', async () => {
      const member = await as(MEMBER);
      await member.put(`/tags/assignments/file/${ids['a.pdf']}`, { tagIds: [] }).expect(404);
      await member.put(`/tags/assignments/fileFolder/${ids.folder}`, { tagIds: [] }).expect(403);
    });

    it('系統資料夾不能貼標籤', async () => {
      const admin = await as(ADMIN);
      const [system] = await db.select().from(fileFolders).where(eq(fileFolders.kind, 'shared'));
      const response = await admin
        .put(`/tags/assignments/fileFolder/${system!.id}`, { tagIds: [ids.contract] })
        .expect(403);
      expect(errorOf(response).code).toBe('FILE_FOLDER_SYSTEM_PROTECTED');
    });
  });

  describe('清理（D4、D9）', () => {
    it('刪除標籤：所有資源上的指派一併刪除，稽核記下貼著的資源數', async () => {
      const admin = await as(ADMIN);
      await admin.delete(`/tags/${ids.urgent}`).expect(204);
      const left = await db.select().from(resourceTags).where(eq(resourceTags.tagId, ids.urgent!));
      expect(left).toHaveLength(0);
      const [audit] = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'tag.delete'), eq(auditLogs.resourceId, ids.urgent!)));
      expect(audit?.metadata).toMatchObject({ assignedResources: 1 });
    });

    it('軟刪除保留指派；回收桶到期永久刪除時一起清掉', async () => {
      const admin = await as(ADMIN);
      await admin.delete(`/files/${ids['a.pdf']}`).expect(204);
      const kept = await db
        .select()
        .from(resourceTags)
        .where(eq(resourceTags.resourceId, ids['a.pdf']!));
      expect(kept).toHaveLength(1);

      await db
        .update(files)
        .set({ deletedAt: new Date(Date.now() - 400 * DAY_MS) })
        .where(inArray(files.id, [ids['a.pdf']!]));
      await inTestTenant(app, () => app.get(TrashService).purgeExpired());
      const purged = await db
        .select()
        .from(resourceTags)
        .where(eq(resourceTags.resourceId, ids['a.pdf']!));
      expect(purged).toHaveLength(0);
      // 標籤的定義還在
      expect(await db.select().from(tags).where(eq(tags.id, ids.contract!))).toHaveLength(1);
    });
  });
});
