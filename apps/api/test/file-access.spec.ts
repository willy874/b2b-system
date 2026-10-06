import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { and, asc, desc, eq, inArray, like, sql } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ObjectStorage } from '@/core/storage';
import {
  auditLogs,
  fileFolders,
  files,
  permissions,
  relationTuples,
  roleHolderTuple,
  rolePermissionTuple,
  roles,
  users,
} from '@/db/schema';
import { FileFolderTree } from '@/modules/file/file-folder-tree';
import { FileFolderRepository } from '@/modules/file/file-folder.repository';
import { FileSystemFolderService } from '@/modules/file/file-system-folder.service';

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

const SUPER_ADMIN = { email: 'access-root@example.com', password: 'Quiet-Harbor-Lantern-26' };
const ADMIN = { email: 'access-admin@example.com', password: 'AdminPassword!2026' };
/** member ＋ 美術組 */
const ARTIST = { email: 'access-artist@example.com', password: 'ArtistPassword!2026' };
/** 只有 member */
const OUTSIDER = { email: 'access-outsider@example.com', password: 'OutsiderPassword!2026' };
/** 全域 file:read ＋ file:share，沒有 file:create */
const SHARER = { email: 'access-sharer@example.com', password: 'SharerPassword!2026' };

const tokenCache = new Map<string, string>();
async function login(credentials: { email: string; password: string }): Promise<string> {
  const cached = tokenCache.get(credentials.email);
  if (cached) return cached;
  const response = await request(http).post('/auth/login').send(credentials).expect(200);
  const token = (response.body as { data: { accessToken: string } }).data.accessToken;
  tokenCache.set(credentials.email, token);
  return token;
}

async function roleId(slug: string): Promise<string> {
  const [role] = await db.select().from(roles).where(eq(roles.slug, slug));
  if (!role) throw new Error(`沒有角色 ${slug}`);
  return role.id;
}

async function createRole(slug: string, keys: string[] = []): Promise<string> {
  const [role] = await db.insert(roles).values({ slug, name: slug }).returning();
  if (!role) throw new Error('建立角色失敗');
  for (const key of keys) {
    // oxlint-disable-next-line no-await-in-loop -- 測試資料，筆數很少
    const [permission] = await db.select().from(permissions).where(eq(permissions.key, key));
    if (!permission) throw new Error(`沒有權限 ${key}`);
    // oxlint-disable-next-line no-await-in-loop -- 同上
    await db.insert(relationTuples).values(rolePermissionTuple(role.id, permission.key));
  }
  return role.id;
}

async function createActiveUser(
  credentials: { email: string; password: string },
  roleIds: string[],
): Promise<string> {
  const { hashPassword } = await import('@/modules/credential/password');
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
  if (roleIds.length > 0) {
    await db.insert(relationTuples).values(roleIds.map((id) => roleHolderTuple(id, user.id)));
  }
  return user.id;
}

interface FolderBody {
  id: string;
  name: string;
  parentId: string | null;
  kind: string;
  hasPendingAccessRequest: boolean;
  capabilities: {
    canRead: boolean;
    canCreate: boolean;
    canUpdate: boolean;
    canDelete: boolean;
    canShare: boolean;
  };
}
interface FileBody {
  id: string;
  name: string;
  folderId: string | null;
  version: number;
  capabilities: { canUpdate: boolean; canDelete: boolean };
}
interface GrantListBody {
  assignableLevels: string[];
  items: {
    subjectType: string;
    subjectId: string;
    level: string;
    source: { folderId: string; folderName: string } | null;
  }[];
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

async function createFolder(token: string, name: string, parentId: string | null = null) {
  const response = await api(token).post('/file-folders', { name, parentId }).expect(201);
  return (response.body as { data: FolderBody }).data;
}

async function uploadFile(token: string, name: string, folderId: string | null) {
  const started = await api(token)
    .post('/files', { name, contentType: 'text/plain', size: 10, folderId })
    .expect(201);
  const { file, upload } = (started.body as { data: { file: FileBody; upload: { url: string } } })
    .data;
  storage.simulateBrowserUpload(upload.url, 10);
  const completed = await api(token).post(`/files/${file.id}/complete`, {}).expect(200);
  return (completed.body as { data: FileBody }).data;
}

async function listFolders(token: string) {
  const response = await api(token).get('/file-folders').expect(200);
  return (
    response.body as { data: { items: FolderBody[]; rootCapabilities: { canCreate: boolean } } }
  ).data;
}

/** 讀得到（沒有鎖住）的一般資料夾名稱（系統資料夾另外測，§12），排序後比對。 */
async function readableNames(token: string): Promise<string[]> {
  const { items } = await listFolders(token);
  return items
    .filter((folder) => folder.kind === 'normal' && folder.capabilities.canRead)
    .map((folder) => folder.name)
    .toSorted();
}

async function listFiles(token: string, query = '') {
  const response = await api(token).get(`/files${query}`).expect(200);
  return (response.body as { data: { items: FileBody[] } }).data.items;
}

function errorCode(response: request.Response): string {
  return (response.body as { error: { code: string } }).error.code;
}

describe('資料夾層級授權（docs/rbac/07-resource-grants.md）', () => {
  let artTeam: string;
  let art: FolderBody;
  let artUi: FolderBody;
  let plan: FolderBody;
  let adminArtFile: FileBody;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN.email;
    process.env.SUPER_ADMIN_PASSWORD = SUPER_ADMIN.password;

    const created = createTestDatabase();
    db = created.db;
    closeDb = async () => created.client.end();
    await truncateAll(db);
    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);

    artTeam = await createRole('art-team');
    const sharer = await createRole('sharer', ['file:read', 'file:share']);
    await createActiveUser(ADMIN, [await roleId('admin')]);
    await createActiveUser(ARTIST, [await roleId('member'), artTeam]);
    await createActiveUser(OUTSIDER, [await roleId('member')]);
    await createActiveUser(SHARER, [sharer]);

    const { AppModule } = await import('@/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ObjectStorage)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    http = await listenOnLoopback(app);

    const admin = await login(ADMIN);
    art = await createFolder(admin, '美術');
    artUi = await createFolder(admin, 'ui', art.id);
    plan = await createFolder(admin, '企劃');
    adminArtFile = await uploadFile(admin, 'admin.txt', art.id);
    await uploadFile(admin, 'plan.txt', plan.id);
    await uploadFile(admin, 'root.txt', null);
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  it('只有 file:access、沒有任何授權：看得到資料夾但全部鎖住、看不到檔案、根目錄不能建立', async () => {
    const artist = await login(ARTIST);
    const folders = (await listFolders(artist)).items.filter((folder) => folder.kind === 'normal');
    expect(folders.map((folder) => folder.name).toSorted()).toEqual(['ui', '企劃', '美術']);
    expect(folders.every((folder) => !folder.capabilities.canRead)).toBe(true);
    expect((await listFolders(artist)).rootCapabilities).toEqual({ canCreate: false });
    expect(await listFiles(artist)).toEqual([]);
    expect(await listFiles(artist, '?folderId=root')).toEqual([]);
  });

  it('授權給角色 → 角色的持有者看到該資料夾與子孫、其中的檔案；其他資料夾鎖住（403）', async () => {
    const admin = await login(ADMIN);
    const granted = await api(admin)
      .put(`/file-folders/${art.id}/grants`, {
        subjectType: 'role',
        subjectId: artTeam,
        level: 'contributor',
      })
      .expect(200);
    expect((granted.body as { data: GrantListBody }).data.items).toEqual([
      expect.objectContaining({ subjectId: artTeam, level: 'contributor', source: null }),
    ]);

    const artist = await login(ARTIST);
    const folders = await listFolders(artist);
    expect(await readableNames(artist)).toEqual(['ui', '美術']);
    expect(folders.items.find((folder) => folder.id === art.id)?.capabilities).toEqual({
      canRead: true,
      canCreate: true,
      canUpdate: false,
      canDelete: false,
      canShare: false,
    });
    expect((await listFiles(artist)).map((file) => file.name)).toEqual(['admin.txt']);
    const locked = await api(artist).get(`/files?folderId=${plan.id}`).expect(403);
    expect(errorCode(locked)).toBe('AUTHZ_FORBIDDEN');

    // 沒有授權的成員：資料夾都鎖住
    expect(await readableNames(await login(OUTSIDER))).toEqual([]);
  });

  it('擁有者規則：能上傳的位置，自己上傳的能改名刪除；別人的不行（403 並寫 authz.denied）', async () => {
    const artist = await login(ARTIST);
    const mine = await uploadFile(artist, 'mine.txt', art.id);
    expect(mine.capabilities).toEqual({ canUpdate: true, canDelete: true });
    await api(artist)
      .patch(`/files/${mine.id}`, { name: 'mine2.txt', version: mine.version })
      .expect(200);

    const theirs = (await listFiles(artist, `?folderId=${art.id}`)).find(
      (file) => file.id === adminArtFile.id,
    );
    expect(theirs?.capabilities).toEqual({ canUpdate: false, canDelete: false });
    const denied = await api(artist)
      .patch(`/files/${adminArtFile.id}`, { name: 'hacked.txt', version: adminArtFile.version })
      .expect(403);
    expect(errorCode(denied)).toBe('AUTHZ_FORBIDDEN');
    await api(artist).delete(`/files/${adminArtFile.id}`).expect(403);

    // 限定這個檔案：前一個測試也留下一筆 authz.denied（鎖住的資料夾），沒有篩選時取到哪一筆取決於查詢計畫
    const [record] = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, 'authz.denied'),
          eq(auditLogs.errorCode, 'AUTHZ_FORBIDDEN'),
          sql`${auditLogs.metadata}->>'resourceId' = ${adminArtFile.id}`,
        ),
      )
      .orderBy(asc(auditLogs.id))
      .limit(1);
    expect(record?.metadata).toMatchObject({
      action: 'update',
      resourceType: 'file',
      resourceId: adminArtFile.id,
    });

    await api(artist).delete(`/files/${mine.id}`).expect(204);
  });

  it('鎖住的資料夾裡的檔案：詳情 404（檔案不公開）；上傳到鎖住的資料夾 403', async () => {
    const artist = await login(ARTIST);
    const plans = await listFiles(await login(ADMIN), `?folderId=${plan.id}`);
    const response = await api(artist).get(`/files/${plans[0]?.id}`).expect(404);
    expect(errorCode(response)).toBe('FILE_NOT_FOUND');
    await api(artist)
      .post('/files', { name: 'x.txt', contentType: 'text/plain', size: 1, folderId: plan.id })
      .expect(403);
  });

  it('contributor 不能管理授權；manager 可以，並看得到繼承來的授權與來源', async () => {
    const artist = await login(ARTIST);
    await api(artist).get(`/file-folders/${art.id}/grants`).expect(403);

    const admin = await login(ADMIN);
    await api(admin)
      .put(`/file-folders/${artUi.id}/grants`, {
        subjectType: 'role',
        subjectId: artTeam,
        level: 'manager',
      })
      .expect(200);

    const list = await api(artist).get(`/file-folders/${artUi.id}/grants`).expect(200);
    const body = (list.body as { data: GrantListBody }).data;
    expect(body.assignableLevels).toEqual(['viewer', 'contributor', 'editor', 'manager']);
    expect(body.items).toEqual([
      expect.objectContaining({ subjectId: artTeam, level: 'manager', source: null }),
      expect.objectContaining({
        subjectId: artTeam,
        level: 'contributor',
        source: { folderId: art.id, folderName: '美術' },
      }),
    ]);

    // manager 可以把 ui 分享給 member 角色（viewer）
    await api(artist)
      .put(`/file-folders/${artUi.id}/grants`, {
        subjectType: 'role',
        subjectId: await roleId('member'),
        level: 'viewer',
      })
      .expect(200);
    expect(await readableNames(await login(OUTSIDER))).toEqual(['ui']);

    const subjects = await api(artist)
      .get(`/file-folders/${artUi.id}/grant-subjects?keyword=art`)
      .expect(200);
    expect((subjects.body as { data: { items: { id: string }[] } }).data.items).toEqual([
      expect.objectContaining({ id: artTeam }),
    ]);
  });

  it('反提權：只有全域 file:read ＋ file:share 的人能授予 viewer，不能授予 contributor', async () => {
    const sharer = await login(SHARER);
    const list = await api(sharer).get(`/file-folders/${plan.id}/grants`).expect(200);
    expect((list.body as { data: GrantListBody }).data.assignableLevels).toEqual(['viewer']);

    const escalated = await api(sharer)
      .put(`/file-folders/${plan.id}/grants`, {
        subjectType: 'role',
        subjectId: artTeam,
        level: 'contributor',
      })
      .expect(403);
    expect(errorCode(escalated)).toBe('AUTHZ_ESCALATION');
    expect((escalated.body as { error: { details: { missing: string[] } } }).error.details).toEqual(
      {
        missing: ['file:create'],
      },
    );

    await api(sharer)
      .put(`/file-folders/${plan.id}/grants`, {
        subjectType: 'role',
        subjectId: artTeam,
        level: 'viewer',
      })
      .expect(200);
    // 也不能把別人授予的較高等級降級或移除
    await api(sharer).delete(`/file-folders/${art.id}/grants/role/${artTeam}`).expect(403);
  });

  it('移除授權：上層的授權沒了，上層鎖住、被直接授權的子資料夾仍讀得到', async () => {
    const admin = await login(ADMIN);
    await api(admin).delete(`/file-folders/${art.id}/grants/role/${artTeam}`).expect(204);
    const missing = await api(admin)
      .delete(`/file-folders/${art.id}/grants/role/${artTeam}`)
      .expect(404);
    expect(errorCode(missing)).toBe('FILE_GRANT_NOT_FOUND');

    // 企劃是上一個測試授予美術組 viewer 的；美術仍列出但鎖住
    expect(await readableNames(await login(ARTIST))).toEqual(['ui', '企劃']);

    const [record] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'fileFolder.revoke'));
    expect(record).toMatchObject({ resourceId: art.id, resourceType: 'fileFolder' });
  });

  it('授權對象不存在 → FILE_GRANT_SUBJECT_NOT_FOUND', async () => {
    const response = await api(await login(ADMIN))
      .put(`/file-folders/${art.id}/grants`, {
        subjectType: 'role',
        subjectId: '00000000-0000-4000-8000-000000000000',
        level: 'viewer',
      })
      .expect(404);
    expect(errorCode(response)).toBe('FILE_GRANT_SUBJECT_NOT_FOUND');
  });

  it('同一資料夾同一對象只有一個等級：再次授予是覆寫', async () => {
    const admin = await login(ADMIN);
    for (const level of ['viewer', 'editor'] as const) {
      // oxlint-disable-next-line no-await-in-loop -- 依序授予，第二次覆寫第一次
      await api(admin)
        .put(`/file-folders/${plan.id}/grants`, { subjectType: 'role', subjectId: artTeam, level })
        .expect(200);
    }
    const edges = await db
      .select({ relation: relationTuples.relation })
      .from(relationTuples)
      .where(
        and(
          eq(relationTuples.objectType, 'fileFolder'),
          eq(relationTuples.objectId, plan.id),
          eq(relationTuples.subjectId, artTeam),
        ),
      );
    expect(edges).toEqual([{ relation: 'editor' }]);
  });

  it('P2：授權給個別使用者，並可搜尋使用者當對象；過期之後不再計入但仍列出', async () => {
    const admin = await login(ADMIN);
    const [outsiderUser] = await db.select().from(users).where(eq(users.email, OUTSIDER.email));
    const subjects = await api(admin)
      .get(`/file-folders/${plan.id}/grant-subjects?subjectType=user&keyword=outsider`)
      .expect(200);
    expect((subjects.body as { data: { items: { id: string }[] } }).data.items).toEqual([
      expect.objectContaining({ id: outsiderUser?.id, subjectType: 'user' }),
    ]);

    const past = await api(admin)
      .put(`/file-folders/${plan.id}/grants`, {
        subjectType: 'user',
        subjectId: outsiderUser?.id,
        level: 'viewer',
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      })
      .expect(400);
    expect(errorCode(past)).toBe('VALIDATION_FAILED');

    await api(admin)
      .put(`/file-folders/${plan.id}/grants`, {
        subjectType: 'user',
        subjectId: outsiderUser?.id,
        level: 'viewer',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      })
      .expect(200);
    const outsider = await login(OUTSIDER);
    expect(await readableNames(outsider)).toContain('企劃');

    // 讓它過期（直接改資料：API 不接受過去的時間）
    await db
      .update(relationTuples)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(
        and(
          eq(relationTuples.objectType, 'fileFolder'),
          eq(relationTuples.objectId, plan.id),
          eq(relationTuples.subjectId, outsiderUser!.id),
        ),
      );
    expect(await readableNames(outsider)).not.toContain('企劃');
    const list = await api(admin).get(`/file-folders/${plan.id}/grants`).expect(200);
    expect(
      (list.body as { data: GrantListBody & { items: { isExpired: boolean }[] } }).data.items,
    ).toContainEqual(expect.objectContaining({ subjectType: 'user', isExpired: true }));
  });

  it('P2：中斷繼承 → 複製目前繼承到的授權；移除之後上層的人看不到，全域權限者仍看得到', async () => {
    const admin = await login(ADMIN);
    await api(admin)
      .put(`/file-folders/${art.id}/grants`, {
        subjectType: 'role',
        subjectId: artTeam,
        level: 'contributor',
      })
      .expect(200);
    const secret = await createFolder(admin, '私人', art.id);
    const artist = await login(ARTIST);
    expect(await readableNames(artist)).toContain('私人');

    const broken = await api(admin)
      .patch(`/file-folders/${secret.id}/access`, { inheritGrants: false })
      .expect(200);
    const body = (broken.body as { data: GrantListBody & { inheritGrants: boolean } }).data;
    expect(body.inheritGrants).toBe(false);
    expect(body.items).toEqual([
      expect.objectContaining({ subjectId: artTeam, level: 'contributor', source: null }),
    ]);
    // 複製之後還看得到
    expect(await readableNames(artist)).toContain('私人');

    await api(admin).delete(`/file-folders/${secret.id}/grants/role/${artTeam}`).expect(204);
    const visible = await readableNames(artist);
    expect(visible).toContain('美術');
    expect(visible).not.toContain('私人');
    // 全域 file:read 不受私人資料夾影響
    const adminFolders = await listFolders(admin);
    expect(adminFolders.items.find((folder) => folder.id === secret.id)).toMatchObject({
      inheritGrants: false,
    });

    const [record] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'fileFolder.inheritance'));
    expect(record).toMatchObject({ resourceId: secret.id });

    // 恢復繼承：上層的授權又流下來
    await api(admin)
      .patch(`/file-folders/${secret.id}/access`, { inheritGrants: true })
      .expect(200);
    expect(await readableNames(artist)).toContain('私人');
  });

  describe('申請存取（docs/rbac/07-resource-grants.md §6.5）', () => {
    async function pendingRequests(token: string, folderId: string) {
      const response = await api(token)
        .get(`/file-folders/${folderId}/access-requests`)
        .expect(200);
      return (response.body as { data: { items: { id: string; level: string }[] } }).data.items;
    }

    it('申請 → 重送不另建 → 清單標出申請中 → 資料夾管理者核准 → 讀得到', async () => {
      const outsider = await login(OUTSIDER);
      const first = await api(outsider)
        .post(`/file-folders/${plan.id}/access-requests`, { level: 'viewer', reason: '需要看企劃' })
        .expect(202);
      expect((first.body as { data: { submitted: boolean } }).data.submitted).toBe(true);
      const again = await api(outsider)
        .post(`/file-folders/${plan.id}/access-requests`, { level: 'viewer' })
        .expect(202);
      expect((again.body as { data: { submitted: boolean } }).data.submitted).toBe(false);

      const folders = await listFolders(outsider);
      expect(folders.items.find((folder) => folder.id === plan.id)).toMatchObject({
        hasPendingAccessRequest: true,
        capabilities: { canRead: false },
      });

      // 只有 viewer 的人不能審
      await api(await login(ARTIST))
        .get(`/file-folders/${plan.id}/access-requests`)
        .expect(403);

      const admin = await login(ADMIN);
      const [request] = await pendingRequests(admin, plan.id);
      expect(request).toMatchObject({ level: 'viewer' });
      // 不是這個資料夾的申請
      await api(admin)
        .post(`/file-folders/${art.id}/access-requests/${request?.id}/approve`, {})
        .expect(404);
      await api(admin)
        .post(`/file-folders/${plan.id}/access-requests/${request?.id}/approve`, {})
        .expect(204);

      expect(await readableNames(outsider)).toContain('企劃');
      expect(await pendingRequests(admin, plan.id)).toEqual([]);
      const [record] = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'fileFolder.grant'), eq(auditLogs.resourceId, plan.id)))
        .orderBy(desc(auditLogs.occurredAt))
        .limit(1);
      expect(record?.metadata).toMatchObject({ approvalId: request?.id });

      // 已經有這個等級
      const granted = await api(outsider)
        .post(`/file-folders/${plan.id}/access-requests`, { level: 'viewer' })
        .expect(409);
      expect(errorCode(granted)).toBe('FILE_ACCESS_ALREADY_GRANTED');
    });

    it('駁回：申請消失、權限不變', async () => {
      const outsider = await login(OUTSIDER);
      await api(outsider)
        .post(`/file-folders/${plan.id}/access-requests`, { level: 'contributor' })
        .expect(202);
      const admin = await login(ADMIN);
      const [request] = await pendingRequests(admin, plan.id);
      await api(admin)
        .post(`/file-folders/${plan.id}/access-requests/${request?.id}/reject`, {
          comment: '不需要',
        })
        .expect(204);
      expect(await pendingRequests(admin, plan.id)).toEqual([]);
      const folder = (await listFolders(outsider)).items.find((item) => item.id === plan.id);
      expect(folder?.capabilities.canCreate).toBe(false);
    });

    it('也可以從審批頁核准（approval:review）；申請人自己沒有 approval:review 不能核准', async () => {
      const outsider = await login(OUTSIDER);
      await api(outsider)
        .post(`/file-folders/${art.id}/access-requests`, { level: 'editor' })
        .expect(202);
      const admin = await login(ADMIN);
      const [request] = await pendingRequests(admin, art.id);
      await api(outsider).post(`/approvals/${request?.id}/approve`, {}).expect(403);
      await api(admin).post(`/approvals/${request?.id}/approve`, {}).expect(200);
      const folder = (await listFolders(outsider)).items.find((item) => item.id === art.id);
      expect(folder?.capabilities).toMatchObject({
        canRead: true,
        canUpdate: false,
        canCreate: true,
      });
    });
  });

  describe('系統資料夾（docs/rbac/07-resource-grants.md §12）', () => {
    const byKind = (items: FolderBody[], kind: string) =>
      items.filter((folder) => folder.kind === kind);

    it('啟動時建立共用資料夾（所有人 editor）與私人資料夾；每個能進檔案管理器的人有自己的個人資料夾', async () => {
      const artist = await login(ARTIST);
      const list = await listFolders(artist);
      const [shared] = byKind(list.items, 'shared');
      const [privateRoot] = byKind(list.items, 'privateRoot');
      expect(shared).toMatchObject({
        name: '共用資料夾',
        capabilities: { canRead: true, canCreate: true, canUpdate: false, canDelete: false },
      });
      expect(privateRoot).toMatchObject({ name: '私人資料夾', capabilities: { canRead: false } });

      // 別人的個人資料夾也列出但鎖住；自己的是預設位置
      const personalFolderId = (list as unknown as { personalFolderId: string }).personalFolderId;
      const personal = byKind(list.items, 'personal').filter((f) => f.id === personalFolderId);
      expect(byKind(list.items, 'personal').length).toBeGreaterThan(1);
      expect(
        byKind(list.items, 'personal')
          .filter((f) => f.id !== personalFolderId)
          .every((f) => !f.capabilities.canRead),
      ).toBe(true);
      expect(personal[0]).toMatchObject({
        name: ARTIST.email,
        parentId: privateRoot?.id,
        inheritGrants: false,
        capabilities: { canRead: true, canCreate: true, canShare: true, canDelete: false },
      });

      // 共用資料夾：誰都能上傳；上傳的檔案別人也能改（editor）
      const file = await uploadFile(artist, 'shared.txt', shared?.id ?? null);
      const outsider = await login(OUTSIDER);
      await api(outsider)
        .patch(`/files/${file.id}`, { name: 'shared-2.txt', version: file.version })
        .expect(200);

      // 個人資料夾：別人看不到裡面的檔案
      const mine = await uploadFile(artist, 'mine.txt', personal[0]?.id ?? null);
      await api(outsider).get(`/files/${mine.id}`).expect(404);
    });

    it('系統資料夾不能改名、移動、刪除（管理員也一樣）', async () => {
      const admin = await login(ADMIN);
      const { items } = await listFolders(admin);
      const [shared] = byKind(items, 'shared');
      const renamed = await api(admin)
        .patch(`/file-folders/${shared?.id}`, { name: 'x' })
        .expect(403);
      expect(errorCode(renamed)).toBe('FILE_FOLDER_SYSTEM_PROTECTED');
      await api(admin).delete(`/file-folders/${shared?.id}`).expect(403);
      await api(admin)
        .post('/files/move', { fileIds: [], folderIds: [shared?.id], targetFolderId: art.id })
        .expect(403);
      // 全域 file:read：看得到每個人的個人資料夾
      expect(byKind(items, 'personal').length).toBeGreaterThan(1);
    });

    it('指派檔案管理器的角色 → 自動建立個人資料夾', async () => {
      const newcomer = { email: 'access-newcomer@example.com', password: 'NewcomerPassword!2026' };
      const id = await createActiveUser(newcomer, []);
      const admin = await login(ADMIN);
      await api(admin)
        .put(`/users/${id}/roles`, { roleIds: [await roleId('member')], expectedRoleIds: [] })
        .expect(200);
      // 事件在回應之後處理：等它落地
      await expect
        .poll(async () => {
          const list = await listFolders(await login(newcomer));
          const { personalFolderId } = list as unknown as { personalFolderId: string | null };
          return list.items.find((f) => f.id === personalFolderId)?.name;
        })
        .toBe(newcomer.email);
    });

    it('角色的權限加上檔案權限 → 持有者自動建立個人資料夾', async () => {
      const holder = { email: 'access-promoted@example.com', password: 'PromotedPassword!2026' };
      const noFiles = await createRole('access-no-files', ['user:read']);
      await createActiveUser(holder, [noFiles]);
      const root = await login(SUPER_ADMIN);
      await api(root)
        .patch(`/roles/${noFiles}/permissions`, { add: ['file:access'], remove: [] })
        .expect(200);
      // 事件在回應之後處理：等它落地
      await expect
        .poll(async () => {
          const list = await listFolders(await login(holder));
          const { personalFolderId } = list as unknown as { personalFolderId: string | null };
          return list.items.find((f) => f.id === personalFolderId)?.name;
        })
        .toBe(holder.email);
    });

    it('刪除使用者：空的個人資料夾自動刪除；有東西的保留', async () => {
      const admin = await login(ADMIN);
      const emptyOne = { email: 'access-empty@example.com', password: 'EmptyPassword!2026' };
      const busyOne = { email: 'access-busy@example.com', password: 'BusyPassword!2026' };
      const member = await roleId('member');
      const emptyId = await createActiveUser(emptyOne, []);
      const busyId = await createActiveUser(busyOne, []);
      for (const id of [emptyId, busyId]) {
        // oxlint-disable-next-line no-await-in-loop -- 依序指派，等各自的個人資料夾建好
        await api(admin)
          .put(`/users/${id}/roles`, { roleIds: [member], expectedRoleIds: [] })
          .expect(200);
      }
      const personalOf = async (email: string) =>
        byKind((await listFolders(admin)).items, 'personal').find((f) => f.name === email);
      await expect.poll(async () => Boolean(await personalOf(busyOne.email))).toBe(true);
      await expect.poll(async () => Boolean(await personalOf(emptyOne.email))).toBe(true);
      const busyFolder = await personalOf(busyOne.email);
      await uploadFile(await login(busyOne), 'keep.txt', busyFolder?.id ?? null);

      await api(admin).delete(`/users/${emptyId}`).expect(204);
      await api(admin).delete(`/users/${busyId}`).expect(204);
      await expect.poll(async () => Boolean(await personalOf(emptyOne.email))).toBe(false);
      expect(await personalOf(busyOne.email)).toBeDefined();
    });

    it('個人資料夾撞名：依序加上 email、編號，名稱經過清理；一個人失敗不影響同一批的其他人', async () => {
      const [privateRoot] = await db
        .select()
        .from(fileFolders)
        .where(eq(fileFolders.kind, 'privateRoot'));
      if (!privateRoot) throw new Error('沒有私人資料夾');
      // 前兩個候選名稱都被佔用（例：同名的人被刪除後留下有內容的個人資料夾）
      await db.insert(fileFolders).values([
        { name: 'Dup', parentId: privateRoot.id },
        { name: 'Dup (dup@example.com)', parentId: privateRoot.id },
      ]);
      const [dup, slash] = await db
        .insert(users)
        .values([
          { email: 'dup@example.com', displayName: 'Dup', status: 'active' },
          { email: 'slash@example.com', displayName: '../a/b', status: 'active' },
        ])
        .returning();
      if (!dup || !slash) throw new Error('建立使用者失敗');

      await inTestTenant(app, () =>
        app.get(FileSystemFolderService).ensurePersonalFolders([dup.id, slash.id]),
      );
      const personal = await db
        .select()
        .from(fileFolders)
        .where(and(eq(fileFolders.kind, 'personal'), eq(fileFolders.parentId, privateRoot.id)));
      const nameOf = (ownerId: string) => personal.find((row) => row.ownerId === ownerId)?.name;
      expect(nameOf(dup.id)).toBe('Dup (dup@example.com) 2');
      expect(nameOf(slash.id)).toBe('.. a b');
    });

    it('同一批裡一個人的個人資料夾建立失敗，只 rollback 他自己（savepoint）', async () => {
      const [broken, fine] = await db
        .insert(users)
        .values([
          { email: 'broken-owner@example.com', displayName: 'Broken', status: 'active' },
          { email: 'fine-owner@example.com', displayName: 'Fine', status: 'active' },
        ])
        .returning();
      if (!broken || !fine) throw new Error('建立使用者失敗');
      const repo = app.get(FileFolderRepository);
      const original = repo.create.bind(repo);
      const spy = vi.spyOn(repo, 'create').mockImplementation(async (values, tx) => {
        if (values[0]?.ownerId === broken.id) throw new Error('模擬的寫入失敗');
        return original(values, tx);
      });
      try {
        await inTestTenant(app, () =>
          app.get(FileSystemFolderService).ensurePersonalFolders([broken.id, fine.id]),
        );
      } finally {
        spy.mockRestore();
      }
      const owners = (
        await db.select().from(fileFolders).where(eq(fileFolders.kind, 'personal'))
      ).map((row) => row.ownerId);
      expect(owners).toContain(fine.id);
      expect(owners).not.toContain(broken.id);
    });
  });

  describe('大量資料夾（docs/architecture/backend/09-file.md §11：範圍以陣列參數傳遞）', () => {
    /** 超過 postgres.js 的參數上限（65,534）：逐一綁定的 IN 清單會拋 MAX_PARAMETERS_EXCEEDED。 */
    const BULK = 66_000;
    const CHUNK = 5_000;

    it('member 讀得到 6.6 萬個資料夾：GET /files（不分資料夾、指定資料夾）與 GET /file-folders 都回 200', async () => {
      const [shared] = await db.select().from(fileFolders).where(eq(fileFolders.kind, 'shared'));
      if (!shared) throw new Error('沒有共用資料夾');
      for (let start = 0; start < BULK; start += CHUNK) {
        const rows = Array.from({ length: Math.min(CHUNK, BULK - start) }, (_, i) => ({
          name: `bulk-${start + i}`,
          parentId: shared.id,
        }));
        // oxlint-disable-next-line no-await-in-loop -- 分批插入，每批的參數數在上限以內
        await db.insert(fileFolders).values(rows);
      }
      // 直接寫資料庫：讓程序內的資料夾結構快取重讀（docs/architecture/backend/09-file.md §11.1）
      await inTestTenant(app, async () => app.get(FileFolderTree).invalidate());
      const [target] = await db
        .select()
        .from(fileFolders)
        .where(eq(fileFolders.name, `bulk-${BULK - 1}`));
      if (!target) throw new Error('沒有插入資料夾');

      try {
        const outsider = await login(OUTSIDER);
        const file = await uploadFile(outsider, 'bulk.txt', target.id);

        const anywhere = await listFiles(outsider, `?keyword=bulk.txt`);
        expect(anywhere.map((item) => item.id)).toContain(file.id);
        const inFolder = await listFiles(outsider, `?folderId=${target.id}`);
        expect(inFolder.map((item) => item.id)).toEqual([file.id]);

        const { items } = await listFolders(outsider);
        expect(items.length).toBeGreaterThan(BULK);
      } finally {
        // 軟刪除就好：硬刪除 6.6 萬列要逐列檢查自我參照的外鍵，要等上一分鐘
        const bulk = db
          .select({ id: fileFolders.id })
          .from(fileFolders)
          .where(like(fileFolders.name, 'bulk-%'));
        await db.update(files).set({ deletedAt: new Date() }).where(inArray(files.folderId, bulk));
        await db
          .update(fileFolders)
          .set({ deletedAt: new Date() })
          .where(like(fileFolders.name, 'bulk-%'));
        await inTestTenant(app, async () => app.get(FileFolderTree).invalidate());
      }
    }, 120_000);
  });
});
