import { randomUUID } from 'node:crypto';

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
  roleHolderTuple,
  roles,
  users,
} from '@/db/schema';
import { hashPassword } from '@/modules/credential/password';
import { FileImageService } from '@/modules/file/file-image.service';
import { FileMaintenanceService } from '@/modules/file/file-maintenance.service';
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

const ROOT = { email: 'file-trash-root@example.com', password: 'RootPassword!2026' };
const PASSWORD = 'FileTrashPassword!2026';
const DAY_MS = 24 * 60 * 60 * 1000;

interface FileBody {
  id: string;
  name: string;
  folderId: string | null;
}
interface FolderBody {
  id: string;
  name: string;
  parentId: string | null;
}
interface TrashItemBody {
  id: string;
  type: string;
  name: string;
  description: string | null;
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

async function rootToken(): Promise<string> {
  return login(ROOT.email, ROOT.password);
}

function api(token: string) {
  const auth = (req: request.Test) => req.set('authorization', `Bearer ${token}`);
  return {
    get: (path: string) => auth(request(http).get(path)),
    post: (path: string, body: object = {}) => auth(request(http).post(path)).send(body),
    put: (path: string, body: object) => auth(request(http).put(path)).send(body),
    delete: (path: string) => auth(request(http).delete(path)),
  };
}

async function createUser(email: string, roleSlug: string): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({
      email,
      displayName: `名稱 ${email}`,
      passwordHash: await hashPassword(PASSWORD),
      status: 'active',
    })
    .returning();
  const [role] = await db.select().from(roles).where(eq(roles.slug, roleSlug));
  await db.insert(relationTuples).values(roleHolderTuple(role!.id, user!.id));
  return user!.id;
}

async function createFolder(token: string, name: string, parentId: string | null = null) {
  const response = await api(token).post('/file-folders', { name, parentId }).expect(201);
  return dataOf<FolderBody>(response);
}

async function uploadFile(token: string, name: string, folderId: string | null = null) {
  const started = await api(token)
    .post('/files', { name, contentType: 'application/octet-stream', size: 10, folderId })
    .expect(201);
  const { file, upload } = dataOf<{ file: FileBody; upload: { url: string } }>(started);
  storage.simulateBrowserUpload(upload.url, 10);
  const completed = await api(token).post(`/files/${file.id}/complete`).expect(200);
  return dataOf<FileBody>(completed);
}

async function fileRow(id: string) {
  const [row] = await db.select().from(files).where(eq(files.id, id));
  return row;
}

async function folderRow(id: string) {
  const [row] = await db.select().from(fileFolders).where(eq(fileFolders.id, id));
  return row;
}

async function auditOf(resourceId: string, action: string) {
  const [row] = await db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.resourceId, resourceId), eq(auditLogs.action, action)));
  return row;
}

/** 把刪除時間往前推，模擬已經在回收桶裡放了 `days` 天。 */
async function deletedDaysAgo(
  table: typeof files | typeof fileFolders,
  ids: string[],
  days: number,
) {
  await db
    .update(table)
    .set({ deletedAt: new Date(Date.now() - days * DAY_MS) })
    .where(inArray(table.id, ids));
}

function purge() {
  return inTestTenant(app, () => app.get(TrashService).purgeExpired());
}

describe('檔案與資料夾的還原與回收桶（docs/architecture/backend/13-trash.md §7、ADR-0025 D5、R4a）', () => {
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

  describe('deletion_id（D5）', () => {
    it('遞迴刪除：資料夾、子孫、其中的檔案帶同一個 deletion_id 與刪除時間；個別刪除另有自己的', async () => {
      const token = await rootToken();
      const top = await createFolder(token, '批次 A');
      const sub = await createFolder(token, '子', top.id);
      const inTop = await uploadFile(token, 'a.bin', top.id);
      const inSub = await uploadFile(token, 'b.bin', sub.id);
      const alone = await uploadFile(token, 'alone.bin', top.id);
      await api(token).delete(`/files/${alone.id}`).expect(204);
      await api(token).delete(`/file-folders/${top.id}`).expect(204);

      const batch = [await folderRow(top.id), await folderRow(sub.id)];
      const batchFiles = [await fileRow(inTop.id), await fileRow(inSub.id)];
      const deletionId = batch[0]?.deletionId;
      expect(deletionId).toEqual(expect.any(String));
      for (const row of [...batch, ...batchFiles]) {
        expect(row?.deletionId).toBe(deletionId);
        expect(row?.deletedAt).toEqual(batch[0]?.deletedAt);
      }
      const aloneRow = await fileRow(alone.id);
      expect(aloneRow?.deletionId).toEqual(expect.any(String));
      expect(aloneRow?.deletionId).not.toBe(deletionId);
    });
  });

  describe('POST /files/:id/restore', () => {
    it('R4a：個別刪除時物件已被刪掉 → 409 FILE_RESTORE_CONFLICT（objectMissing）', async () => {
      const token = await rootToken();
      const file = await uploadFile(token, 'gone.bin');
      await api(token).delete(`/files/${file.id}`).expect(204);
      expect(storage.objects.has(`files/${file.id}`)).toBe(false);

      const response = await api(token).post(`/files/${file.id}/restore`).expect(409);
      expect(errorOf(response)).toMatchObject({
        code: 'FILE_RESTORE_CONFLICT',
        details: { reason: 'objectMissing' },
      });
      expect((await fileRow(file.id))?.deletedAt).not.toBeNull();
    });

    it('物件還在（模擬 R4b 之後的刪除）→ 還原、重新出現在列表、稽核 file.restore', async () => {
      const token = await rootToken();
      const folder = await createFolder(token, '還原檔案');
      const file = await uploadFile(token, 'kept.bin', folder.id);
      // 只軟刪除紀錄、不刪物件：R4b 之後刪除檔案的樣子
      await db
        .update(files)
        .set({ deletedAt: new Date(), deletionId: randomUUID() })
        .where(eq(files.id, file.id));

      const restored = await api(token).post(`/files/${file.id}/restore`).expect(200);
      expect(dataOf<FileBody>(restored)).toMatchObject({ id: file.id, folderId: folder.id });
      const row = await fileRow(file.id);
      expect(row?.deletedAt).toBeNull();
      expect(row?.deletionId).toBeNull();
      await api(token).get(`/files/${file.id}`).expect(200);
      expect(await auditOf(file.id, 'file.restore')).toBeDefined();
    });

    it('所在的資料夾已刪除 → 409 FILE_RESTORE_CONFLICT（parentDeleted，帶上層）', async () => {
      const token = await rootToken();
      const folder = await createFolder(token, '上層已刪');
      const file = await uploadFile(token, 'child.bin', folder.id);
      await api(token).delete(`/file-folders/${folder.id}`).expect(204);

      const response = await api(token).post(`/files/${file.id}/restore`).expect(409);
      expect(errorOf(response)).toEqual(
        expect.objectContaining({
          code: 'FILE_RESTORE_CONFLICT',
          details: { reason: 'parentDeleted', parentType: 'fileFolder', parentId: folder.id },
        }),
      );
    });

    it('沒有被刪除 → 409 FILE_NOT_DELETED；不存在 → 404；只能讀、不能刪的人 → 403', async () => {
      const token = await rootToken();
      const file = await uploadFile(token, 'live.bin');
      expect(errorOf(await api(token).post(`/files/${file.id}/restore`).expect(409)).code).toBe(
        'FILE_NOT_DELETED',
      );
      await api(token).post(`/files/${randomUUID()}/restore`).expect(404);

      // auditor 有 file:read（閘門過得去），但不能刪除 → 也不能還原（D10）
      await db
        .update(files)
        .set({ deletedAt: new Date(), deletionId: randomUUID() })
        .where(eq(files.id, file.id));
      await createUser('file-trash-auditor@example.com', 'auditor');
      const denied = await api(await login('file-trash-auditor@example.com'))
        .post(`/files/${file.id}/restore`)
        .expect(403);
      expect(errorOf(denied).code).toBe('AUTHZ_FORBIDDEN');
    });

    it('只有資料夾授權的成員：自己上傳、自己刪除的檔案可以還原（刪除提示的「復原」）', async () => {
      const token = await rootToken();
      const memberId = await createUser('file-trash-member@example.com', 'member');
      const member = await login('file-trash-member@example.com');
      const folder = await createFolder(token, '成員的資料夾');
      await api(token)
        .put(`/file-folders/${folder.id}/grants`, {
          subjectType: 'user',
          subjectId: memberId,
          level: 'contributor',
        })
        .expect(200);
      const file = await uploadFile(member, 'mine.bin', folder.id);
      await db
        .update(files)
        .set({ deletedAt: new Date(), deletionId: randomUUID(), updatedBy: memberId })
        .where(eq(files.id, file.id));

      await api(member).post(`/files/${file.id}/restore`).expect(200);
      // 回收桶只看全域的 file:delete
      await api(member).get('/trash').query({ type: 'file' }).expect(403);
    });
  });

  describe('POST /file-folders/:id/restore', () => {
    it('只還原同一次刪除的子樹；之前個別刪掉的檔案維持刪除；物件已不在的檔案略過（filesSkipped）', async () => {
      const token = await rootToken();
      const top = await createFolder(token, '整批還原');
      const sub = await createFolder(token, '子資料夾', top.id);
      const earlierSub = await createFolder(token, '先刪的子資料夾', top.id);
      const kept = await uploadFile(token, 'kept.bin', sub.id);
      const lost = await uploadFile(token, 'lost.bin', top.id);
      const earlier = await uploadFile(token, 'earlier.bin', top.id);
      await api(token).delete(`/files/${earlier.id}`).expect(204);
      await api(token).delete(`/file-folders/${earlierSub.id}`).expect(204);
      await api(token).delete(`/file-folders/${top.id}`).expect(204);
      // 遞迴刪除不刪物件；模擬其中一個已經不在（例：舊版的維護排程刪掉了）
      expect(storage.objects.has(`files/${kept.id}`)).toBe(true);
      await storage.delete(`files/${lost.id}`);

      const response = await api(token).post(`/file-folders/${top.id}/restore`).expect(200);
      expect(dataOf<Record<string, unknown>>(response)).toMatchObject({
        id: top.id,
        name: '整批還原',
        foldersRestored: 2,
        filesRestored: 1,
        filesSkipped: 1,
      });
      expect((await folderRow(sub.id))?.deletedAt).toBeNull();
      expect((await fileRow(kept.id))?.deletedAt).toBeNull();
      expect((await folderRow(earlierSub.id))?.deletedAt).not.toBeNull();
      expect((await fileRow(earlier.id))?.deletedAt).not.toBeNull();
      expect((await fileRow(lost.id))?.deletedAt).not.toBeNull();
      const audit = await auditOf(top.id, 'fileFolder.restore');
      expect(audit?.metadata).toMatchObject({ folderCount: 2, fileCount: 1, filesSkipped: 1 });

      // 略過的檔案：資料夾已還原，它改以個別項目出現在回收桶
      const trash = await api(token).get('/trash').query({ type: 'file', keyword: 'lost' });
      expect(dataOf<{ items: TrashItemBody[] }>(trash).items.map((item) => item.id)).toEqual([
        lost.id,
      ]);
    });

    it('上層已刪除 → 409 FILE_FOLDER_RESTORE_CONFLICT；同名 → 409 FILE_FOLDER_NAME_CONFLICT（conflictingId）', async () => {
      const token = await rootToken();
      const top = await createFolder(token, '衝突上層');
      const sub = await createFolder(token, '衝突子', top.id);
      await api(token).delete(`/file-folders/${top.id}`).expect(204);

      const parentDeleted = await api(token).post(`/file-folders/${sub.id}/restore`).expect(409);
      expect(errorOf(parentDeleted)).toMatchObject({
        code: 'FILE_FOLDER_RESTORE_CONFLICT',
        details: { reason: 'parentDeleted', parentType: 'fileFolder', parentId: top.id },
      });

      const taken = await createFolder(token, '衝突上層');
      const conflict = await api(token).post(`/file-folders/${top.id}/restore`).expect(409);
      expect(errorOf(conflict)).toMatchObject({
        code: 'FILE_FOLDER_NAME_CONFLICT',
        details: { conflictingId: taken.id },
      });
    });

    it('沒有被刪除 → 409 FILE_FOLDER_NOT_DELETED；不存在 → 404', async () => {
      const token = await rootToken();
      const folder = await createFolder(token, '沒被刪');
      expect(
        errorOf(await api(token).post(`/file-folders/${folder.id}/restore`).expect(409)).code,
      ).toBe('FILE_FOLDER_NOT_DELETED');
      await api(token).post(`/file-folders/${randomUUID()}/restore`).expect(404);
    });

    it('資料夾授權在刪除期間保留，還原後隨之生效', async () => {
      const token = await rootToken();
      const viewerId = await createUser('file-trash-viewer@example.com', 'member');
      const viewer = await login('file-trash-viewer@example.com');
      const folder = await createFolder(token, '有授權的資料夾');
      await api(token)
        .put(`/file-folders/${folder.id}/grants`, {
          subjectType: 'user',
          subjectId: viewerId,
          level: 'viewer',
        })
        .expect(200);
      await api(token).delete(`/file-folders/${folder.id}`).expect(204);
      await api(viewer).get(`/files?folderId=${folder.id}`).expect(404);

      await api(token).post(`/file-folders/${folder.id}/restore`).expect(200);
      await api(viewer).get(`/files?folderId=${folder.id}`).expect(200);
    });
  });

  describe('GET /trash', () => {
    it('type=fileFolder 只列每一批的根（帶上層路徑）；type=file 只列個別刪除的檔案（帶所在路徑）', async () => {
      const token = await rootToken();
      const parent = await createFolder(token, '路徑上層');
      const top = await createFolder(token, '列表批次', parent.id);
      await createFolder(token, '列表子', top.id);
      const inBatch = await uploadFile(token, '列表-批次內.bin', top.id);
      const alone = await uploadFile(token, '列表-個別.bin', parent.id);
      await api(token).delete(`/files/${alone.id}`).expect(204);
      await api(token).delete(`/file-folders/${top.id}`).expect(204);

      const folders = dataOf<{ items: TrashItemBody[] }>(
        await api(token).get('/trash').query({ type: 'fileFolder', keyword: '列表' }).expect(200),
      );
      expect(folders.items).toEqual([
        expect.objectContaining({ id: top.id, name: '列表批次', description: '/路徑上層' }),
      ]);
      const fileItems = dataOf<{ items: TrashItemBody[] }>(
        await api(token).get('/trash').query({ type: 'file', keyword: '列表-' }).expect(200),
      ).items;
      expect(fileItems.map((item) => item.id)).toEqual([alone.id]);
      expect(fileItems[0]?.description).toBe('/路徑上層');
      expect(fileItems.some((item) => item.id === inBatch.id)).toBe(false);
    });
  });

  describe('file.maintenance（09-file.md §9、ADR-0025 D11）', () => {
    it('紀錄已軟刪除的物件不是孤兒（留給 trash.purge）；查不到任何紀錄的才刪', async () => {
      const token = await rootToken();
      const folder = await createFolder(token, '維護');
      const file = await uploadFile(token, 'trashed.bin', folder.id);
      await api(token).delete(`/file-folders/${folder.id}`).expect(204);
      const twoDaysAgo = new Date(Date.now() - 2 * DAY_MS);
      storage.modifiedAt.set(`files/${file.id}`, twoDaysAgo);
      const orphanKey = `files/${randomUUID()}`;
      storage.objects.set(orphanKey, { size: 1, etag: 'o', contentType: 'text/plain' });
      storage.modifiedAt.set(orphanKey, twoDaysAgo);

      await inTestTenant(app, () => app.get(FileMaintenanceService).sweep());
      expect(storage.objects.has(`files/${file.id}`)).toBe(true);
      expect(storage.objects.has(orphanKey)).toBe(false);
    });
  });

  describe('trash.purge', () => {
    it('到期的資料夾批次：檔案先、資料夾後硬刪除，授權的邊一併刪除，物件在提交後刪除，寫 purge 稽核', async () => {
      const token = await rootToken();
      const memberId = await createUser('file-trash-grantee@example.com', 'member');
      const top = await createFolder(token, '到期批次');
      const sub = await createFolder(token, '到期子', top.id);
      const file = await uploadFile(token, 'expired.bin', sub.id);
      await api(token)
        .put(`/file-folders/${sub.id}/grants`, {
          subjectType: 'user',
          subjectId: memberId,
          level: 'viewer',
        })
        .expect(200);
      await api(token).delete(`/file-folders/${top.id}`).expect(204);
      await deletedDaysAgo(fileFolders, [top.id, sub.id], 60);
      await deletedDaysAgo(files, [file.id], 60);

      const report = await purge();
      expect(report.purged).toMatchObject({
        file: expect.any(Number),
        fileFolder: expect.any(Number),
      });
      expect(await folderRow(top.id)).toBeUndefined();
      expect(await folderRow(sub.id)).toBeUndefined();
      expect(await fileRow(file.id)).toBeUndefined();
      expect(storage.objects.has(`files/${file.id}`)).toBe(false);
      const edges = await db
        .select()
        .from(relationTuples)
        .where(
          and(eq(relationTuples.objectType, 'fileFolder'), eq(relationTuples.objectId, sub.id)),
        );
      expect(edges).toEqual([]);
      expect(await auditOf(file.id, 'file.purge')).toBeDefined();
      expect(await auditOf(top.id, 'fileFolder.purge')).toBeDefined();
    });

    it('還沒到期的不動；使用者的個人資料夾先被清掉，同一輪就能永久刪除使用者', async () => {
      const token = await rootToken();
      const recentFolder = await createFolder(token, '還沒到期');
      await api(token).delete(`/file-folders/${recentFolder.id}`).expect(204);

      const ownerId = await createUser('file-trash-owner@example.com', 'member');
      await db.insert(fileFolders).values({
        name: '個人 owner',
        parentId: null,
        kind: 'personal',
        ownerId,
        deletedAt: new Date(Date.now() - 60 * DAY_MS),
        deletionId: randomUUID(),
      });
      await db
        .update(users)
        .set({ deletedAt: new Date(Date.now() - 60 * DAY_MS) })
        .where(eq(users.id, ownerId));

      await purge();
      expect(await folderRow(recentFolder.id)).toBeDefined();
      const [owner] = await db.select().from(users).where(eq(users.id, ownerId));
      expect(owner).toBeUndefined();
    });
  });
});
