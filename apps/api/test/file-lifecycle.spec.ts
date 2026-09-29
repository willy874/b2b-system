import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ObjectStorage } from '@/core/storage';
import { auditLogs, fileFolders, files, roles, userRoles, users } from '@/db/schema';
import { FileImageService } from '@/modules/file/file-image.service';
import { FileMaintenanceService } from '@/modules/file/file-maintenance.service';

import type { TestDatabase } from './db';
import { createTestDatabase, expectDbError, truncateAll } from './db';
import { InMemoryObjectStorage } from './in-memory-object-storage';
import { inTestTenant } from './tenant';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;
const storage = new InMemoryObjectStorage();

const SUPER_ADMIN = { email: 'file-root@example.com', password: 'RootPassword!2026' };
const ADMIN = { email: 'file-admin@example.com', password: 'AdminPassword!2026' };
const AUDITOR = { email: 'file-auditor@example.com', password: 'AuditorPassword!2026' };
const MEMBER = { email: 'file-member@example.com', password: 'MemberPassword!2026' };

const tokenCache = new Map<string, string>();
async function login(credentials: { email: string; password: string }): Promise<string> {
  const cached = tokenCache.get(credentials.email);
  if (cached) return cached;
  const response = await request(http).post('/auth/login').send(credentials).expect(200);
  const token = (response.body as { data: { accessToken: string } }).data.accessToken;
  tokenCache.set(credentials.email, token);
  return token;
}

async function createActiveUser(email: string, password: string, roleSlug: string) {
  const { hashPassword } = await import('@/modules/auth/password');
  const [user] = await db
    .insert(users)
    .values({
      email,
      displayName: email,
      passwordHash: await hashPassword(password),
      status: 'active',
    })
    .returning();
  const [role] = await db.select().from(roles).where(eq(roles.slug, roleSlug));
  await db.insert(userRoles).values({ userId: user!.id, roleId: role!.id });
}

interface FileBody {
  id: string;
  name: string;
  status: string;
  size: number;
  version: number;
  thumbnailUrl: string | null;
  image: {
    width: number;
    height: number;
    originalUrl: string;
    previewUrl: string;
    thumbnailUrl: string;
  } | null;
  url: string | null;
  downloadUrl: string | null;
  uploader: { displayName: string } | null;
}

async function startUpload(
  token: string,
  body: {
    name: string;
    contentType: string;
    size: number;
    thumbnail?: { contentType: string; size: number };
    folderId?: string;
  },
) {
  const response = await request(http)
    .post('/files')
    .set('authorization', `Bearer ${token}`)
    .send(body)
    .expect(201);
  return (
    response.body as {
      data: {
        file: FileBody;
        upload: { url: string; headers: object };
        multipart: { partSize: number; partCount: number } | null;
        thumbnailUpload: { url: string } | null;
      };
    }
  ).data;
}

async function uploadFile(
  token: string,
  body: { name: string; contentType: string; size: number },
) {
  const { file, upload } = await startUpload(token, body);
  storage.simulateBrowserUpload(upload.url, body.size);
  const response = await request(http)
    .post(`/files/${file.id}/complete`)
    .set('authorization', `Bearer ${token}`)
    .expect(200);
  return (response.body as { data: FileBody }).data;
}

describe('檔案生命週期（docs/architecture/backend/09-file.md）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN.email;
    process.env.SUPER_ADMIN_PASSWORD = SUPER_ADMIN.password;
    process.env.FILE_UPLOAD_MAX_SIZE = '1000';
    // 500 以上改用分塊上傳（每塊 8 MiB → 測試裡的檔案都只有一塊）
    process.env.FILE_MULTIPART_THRESHOLD = '500';

    const created = createTestDatabase();
    db = created.db;
    closeDb = async () => created.client.end();
    await truncateAll(db);
    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);
    await createActiveUser(ADMIN.email, ADMIN.password, 'admin');
    await createActiveUser(AUDITOR.email, AUDITOR.password, 'auditor');
    await createActiveUser(MEMBER.email, MEMBER.password, 'member');

    const { AppModule } = await import('@/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ObjectStorage)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    http = app.getHttpServer() as App;
  });

  afterAll(async () => {
    // 背景的影像變體產生要在關閉資料庫之前結束
    await app.get(FileImageService).whenIdle();
    await app.close();
    await closeDb();
    delete process.env.FILE_UPLOAD_MAX_SIZE;
    delete process.env.FILE_MULTIPART_THRESHOLD;
  });

  it('登記 → 直傳 → 完成：pending 不出現在列表，ready 之後帶可用的網址', async () => {
    const token = await login(ADMIN);
    const { file, upload } = await startUpload(token, {
      name: '角色 立繪.png',
      contentType: 'image/png',
      size: 100,
    });
    expect(file).toMatchObject({ status: 'pending', url: null, downloadUrl: null });
    expect(upload.headers).toEqual({ 'Content-Type': 'image/png' });
    // 不外洩 storage key / bucket
    expect(JSON.stringify(file)).not.toContain('storageKey');

    const listBefore = await request(http).get('/files').set('authorization', `Bearer ${token}`);
    expect((listBefore.body as { data: { items: FileBody[] } }).data.items).toHaveLength(0);

    // 還沒上傳就完成 → 409
    const early = await request(http)
      .post(`/files/${file.id}/complete`)
      .set('authorization', `Bearer ${token}`)
      .expect(409);
    expect((early.body as { error: { code: string } }).error.code).toBe('FILE_UPLOAD_INCOMPLETE');

    storage.simulateBrowserUpload(upload.url, 100);
    const done = await request(http)
      .post(`/files/${file.id}/complete`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const ready = (done.body as { data: FileBody }).data;
    expect(ready).toMatchObject({ status: 'ready', name: '角色 立繪.png', size: 100 });
    expect(ready.url).toContain('signed=inline');
    expect(ready.downloadUrl).toContain('signed=attachment');
    expect(ready.uploader?.displayName).toBe(ADMIN.email);

    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, 'file.upload'));
    expect(audit).toMatchObject({ resourceType: 'file', resourceId: file.id });
  });

  it('上傳大小與登記不符 → 422，物件被刪除', async () => {
    const token = await login(ADMIN);
    const { file, upload } = await startUpload(token, {
      name: 'a.bin',
      contentType: 'application/octet-stream',
      size: 10,
    });
    storage.simulateBrowserUpload(upload.url, 11);
    const response = await request(http)
      .post(`/files/${file.id}/complete`)
      .set('authorization', `Bearer ${token}`)
      .expect(422);
    expect((response.body as { error: { code: string } }).error.code).toBe('FILE_SIZE_MISMATCH');
    expect(storage.objects.has(new URL(upload.url).pathname.slice(1))).toBe(false);
  });

  it('超過 FILE_UPLOAD_MAX_SIZE → 413', async () => {
    const token = await login(ADMIN);
    const response = await request(http)
      .post('/files')
      .set('authorization', `Bearer ${token}`)
      .send({ name: 'huge.bin', contentType: 'application/octet-stream', size: 1001 })
      .expect(413);
    expect((response.body as { error: { code: string } }).error.code).toBe('FILE_TOO_LARGE');
  });

  it('檔名含路徑分隔字元 → 400', async () => {
    const token = await login(ADMIN);
    await request(http)
      .post('/files')
      .set('authorization', `Bearer ${token}`)
      .send({ name: '../etc/passwd', contentType: 'text/plain', size: 1 })
      .expect(400);
  });

  it('列表：keyword 與 contentType（含 image/*）篩選', async () => {
    const token = await login(ADMIN);
    await uploadFile(token, { name: 'bgm-title.mp3', contentType: 'audio/mpeg', size: 5 });
    await uploadFile(token, { name: 'icon.svg', contentType: 'image/svg+xml', size: 5 });

    const images = await request(http)
      .get('/files')
      .query({ contentType: 'image/*' })
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const imageNames = (images.body as { data: { items: FileBody[] } }).data.items.map(
      (f) => f.name,
    );
    expect(imageNames.toSorted()).toEqual(['icon.svg', '角色 立繪.png']);

    const keyword = await request(http)
      .get('/files')
      .query({ keyword: 'BGM' })
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect((keyword.body as { data: { items: FileBody[] } }).data.items.map((f) => f.name)).toEqual(
      ['bgm-title.mp3'],
    );
  });

  it('改名與刪除；刪除後 404 且物件被移除', async () => {
    const token = await login(ADMIN);
    const file = await uploadFile(token, { name: 'old.txt', contentType: 'text/plain', size: 3 });

    const renamed = await request(http)
      .patch(`/files/${file.id}`)
      .set('authorization', `Bearer ${token}`)
      .send({ name: 'new.txt' })
      .expect(200);
    expect((renamed.body as { data: FileBody }).data.name).toBe('new.txt');

    await request(http)
      .delete(`/files/${file.id}`)
      .set('authorization', `Bearer ${token}`)
      .expect(204);
    await request(http)
      .get(`/files/${file.id}`)
      .set('authorization', `Bearer ${token}`)
      .expect(404);
    expect(storage.deleted).toContain(`files/${file.id}`);
  });

  it('auditor 能讀不能上傳；member 只有 file:access：進得來但什麼都看不到', async () => {
    const auditor = await login(AUDITOR);
    await request(http).get('/files').set('authorization', `Bearer ${auditor}`).expect(200);
    await request(http)
      .post('/files')
      .set('authorization', `Bearer ${auditor}`)
      .send({ name: 'x.txt', contentType: 'text/plain', size: 1 })
      .expect(403);

    const member = await login(MEMBER);
    const listed = await request(http)
      .get('/files')
      .set('authorization', `Bearer ${member}`)
      .expect(200);
    expect((listed.body as { data: { items: FileBody[] } }).data.items).toHaveLength(0);
    await request(http)
      .post('/files')
      .set('authorization', `Bearer ${member}`)
      .send({ name: 'x.txt', contentType: 'text/plain', size: 1 })
      .expect(403);
  });

  it('別人的 pending 上傳看不到也不能完成', async () => {
    const admin = await login(ADMIN);
    const root = await login(SUPER_ADMIN);
    const { file } = await startUpload(admin, {
      name: 'draft.txt',
      contentType: 'text/plain',
      size: 1,
    });
    await request(http).get(`/files/${file.id}`).set('authorization', `Bearer ${root}`).expect(404);
    await request(http)
      .post(`/files/${file.id}/complete`)
      .set('authorization', `Bearer ${root}`)
      .expect(404);
  });

  it('分塊上傳：登記 → 要各塊網址 → 逐塊直傳 → 帶 ETag 完成', async () => {
    const token = await login(ADMIN);
    const { file, upload, multipart } = await startUpload(token, {
      name: 'level.pak',
      contentType: 'application/octet-stream',
      size: 600,
    });
    expect(upload).toBeNull();
    expect(multipart).toMatchObject({ partCount: 1 });

    const parts = await request(http)
      .post(`/files/${file.id}/parts`)
      .set('authorization', `Bearer ${token}`)
      .send({ partNumbers: [1] })
      .expect(200);
    const [part] = (parts.body as { data: { parts: Array<{ url: string }> } }).data.parts;
    storage.simulateBrowserUpload(part?.url ?? '', 600);

    // 沒帶 parts → 422
    await request(http)
      .post(`/files/${file.id}/complete`)
      .set('authorization', `Bearer ${token}`)
      .expect(422);
    const done = await request(http)
      .post(`/files/${file.id}/complete`)
      .set('authorization', `Bearer ${token}`)
      .send({ parts: [{ partNumber: 1, etag: '"etag-1"' }] })
      .expect(200);
    expect((done.body as { data: FileBody }).data).toMatchObject({ status: 'ready', size: 600 });
    const [row] = await db.select().from(files).where(eq(files.id, file.id));
    expect(row?.uploadId).toBeNull();
  });

  it('放棄上傳：pending 消失、分塊被清掉；已完成的不能放棄', async () => {
    const token = await login(ADMIN);
    const { file } = await startUpload(token, {
      name: 'cancel.pak',
      contentType: 'application/octet-stream',
      size: 700,
    });
    const uploadsBefore = storage.uploads.size;
    await request(http)
      .delete(`/files/${file.id}/upload`)
      .set('authorization', `Bearer ${token}`)
      .expect(204);
    expect(storage.uploads.size).toBe(uploadsBefore - 1);
    await request(http)
      .get(`/files/${file.id}`)
      .set('authorization', `Bearer ${token}`)
      .expect(404);

    const ready = await uploadFile(token, { name: 'kept.txt', contentType: 'text/plain', size: 2 });
    const response = await request(http)
      .delete(`/files/${ready.id}/upload`)
      .set('authorization', `Bearer ${token}`)
      .expect(409);
    expect((response.body as { error: { code: string } }).error.code).toBe('FILE_ALREADY_UPLOADED');
  });

  it('縮圖：登記時帶 thumbnail、直傳後 complete → 帶 thumbnailUrl', async () => {
    const token = await login(ADMIN);
    const { file, upload, thumbnailUpload } = await startUpload(token, {
      name: 'thumb.png',
      contentType: 'image/png',
      size: 50,
      thumbnail: { contentType: 'image/webp', size: 20 },
    });
    storage.simulateBrowserUpload(upload.url, 50);
    storage.simulateBrowserUpload(thumbnailUpload?.url ?? '', 20, 'image/webp');
    const done = await request(http)
      .post(`/files/${file.id}/complete`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect((done.body as { data: FileBody }).data.thumbnailUrl).toContain(`thumbnails/${file.id}`);
  });

  it('改名的樂觀鎖：拿舊版本改名 → 409 FILE_VERSION_CONFLICT', async () => {
    const token = await login(ADMIN);
    const file = await uploadFile(token, { name: 'v.txt', contentType: 'text/plain', size: 1 });
    expect(file.version).toBe(1);
    const first = await request(http)
      .patch(`/files/${file.id}`)
      .set('authorization', `Bearer ${token}`)
      .send({ name: 'v2.txt', version: 1 })
      .expect(200);
    expect((first.body as { data: FileBody }).data.version).toBe(2);
    const stale = await request(http)
      .patch(`/files/${file.id}`)
      .set('authorization', `Bearer ${token}`)
      .send({ name: 'v3.txt', version: 1 })
      .expect(409);
    expect((stale.body as { error: { code: string } }).error.code).toBe('FILE_VERSION_CONFLICT');
  });

  it('keyset 游標：捲動途中有新檔案插入也不重複、不漏', async () => {
    const token = await login(ADMIN);
    for (const name of ['k1.txt', 'k2.txt', 'k3.txt', 'k4.txt']) {
      await uploadFile(token, { name, contentType: 'text/x-keyset', size: 1 });
    }
    const list = async (query: Record<string, string>) =>
      (
        (
          await request(http)
            .get('/files')
            .query({ contentType: 'text/x-keyset', limit: '2', ...query })
            .set('authorization', `Bearer ${token}`)
            .expect(200)
        ).body as { data: { items: FileBody[]; nextCursor: string | null } }
      ).data;

    const first = await list({});
    expect(first.items.map((f) => f.name)).toEqual(['k4.txt', 'k3.txt']);
    // 第一頁之後插入一筆較新的：offset 分頁會讓 k3 重複出現在第二頁
    await uploadFile(token, { name: 'k5.txt', contentType: 'text/x-keyset', size: 1 });
    const second = await list({ cursor: first.nextCursor ?? '' });
    expect(second.items.map((f) => f.name)).toEqual(['k2.txt', 'k1.txt']);

    await request(http)
      .get('/files')
      .query({ cursor: first.nextCursor ?? '', sort: 'name' })
      .set('authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('分類篩選：document、other', async () => {
    const token = await login(ADMIN);
    await uploadFile(token, { name: 'spec.pdf', contentType: 'application/pdf', size: 1 });
    await uploadFile(token, { name: 'blob.xyz', contentType: 'application/x-custom', size: 1 });
    const names = async (category: string) =>
      (
        (
          await request(http)
            .get('/files')
            .query({ category, limit: '200' })
            .set('authorization', `Bearer ${token}`)
            .expect(200)
        ).body as { data: { items: FileBody[] } }
      ).data.items.map((f) => f.name);
    expect(await names('document')).toEqual(['spec.pdf']);
    const others = await names('other');
    expect(others).toContain('blob.xyz');
    expect(others).not.toContain('spec.pdf');
  });

  it('圖片：完成後實體化全螢幕預覽與圖示預覽；影像 API 不必登入、依請求的格式轉址', async () => {
    const token = await login(ADMIN);
    const content = await sharp({
      create: { width: 64, height: 48, channels: 3, background: '#336699' },
    })
      .png()
      .toBuffer();
    const { file, upload } = await startUpload(token, {
      name: 'sprite.png',
      contentType: 'image/png',
      size: content.length,
    });
    storage.write(new URL(upload.url).pathname.slice(1), content, 'image/png');
    await request(http)
      .post(`/files/${file.id}/complete`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    await app.get(FileImageService).whenIdle();

    const detail = (
      (
        await request(http)
          .get(`/files/${file.id}`)
          .set('authorization', `Bearer ${token}`)
          .expect(200)
      ).body as { data: FileBody }
    ).data;
    expect(detail.image).toMatchObject({ width: 64, height: 48 });
    expect(detail.thumbnailUrl).toBe(detail.image?.thumbnailUrl);
    expect(storage.contents.has(`variants/${file.id}/preview.jpeg`)).toBe(true);
    expect(storage.contents.has(`variants/${file.id}/thumbnail.jpeg`)).toBe(true);

    // 前端拿到的網址帶 `/api` 前綴（反向代理去掉後才進 api）
    const previewPath = (detail.image?.previewUrl ?? '').replace(/^\/api/, '');
    // 不帶 authorization：`<img src>` 帶不了 token
    const preview = await request(http).get(previewPath).expect(302);
    expect(preview.headers.location).toContain(`variants/${file.id}/preview.jpeg`);
    expect(preview.headers['cache-control']).toMatch(/^private, max-age=\d+$/);

    const webp = await request(http).get(`${previewPath}&format=webp`).expect(302);
    expect(webp.headers.location).toContain(`variants/${file.id}/preview.webp`);
    expect(storage.contents.has(`variants/${file.id}/preview.webp`)).toBe(true);

    // 簽章綁定版本：拿預覽的簽章要原圖 → 403
    const tampered = await request(http)
      .get(previewPath.replace('/image/preview?', '/image/original?'))
      .expect(403);
    expect((tampered.body as { error: { code: string } }).error.code).toBe(
      'FILE_IMAGE_URL_INVALID',
    );

    // 刪除時一併刪除變體與轉出的格式
    await request(http)
      .delete(`/files/${file.id}`)
      .set('authorization', `Bearer ${token}`)
      .expect(204);
    expect([...storage.objects.keys()].some((key) => key.startsWith(`variants/${file.id}/`))).toBe(
      false,
    );
    await request(http).get(previewPath).expect(404);
  });

  it('維護排程：偵測並清掉逾時的 pending 上傳與沒有紀錄的物件', async () => {
    const token = await login(ADMIN);
    const { file, upload } = await startUpload(token, {
      name: 'abandoned.bin',
      contentType: 'application/octet-stream',
      size: 10,
    });
    storage.simulateBrowserUpload(upload.url, 10);
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    await db.update(files).set({ createdAt: twoDaysAgo }).where(eq(files.id, file.id));
    const orphanKey = 'thumbnails/99999999-9999-4999-8999-999999999999';
    storage.objects.set(orphanKey, { size: 1, etag: 'o', contentType: 'image/webp' });
    storage.modifiedAt.set(orphanKey, twoDaysAgo);

    const maintenance = app.get(FileMaintenanceService);
    const detected = await inTestTenant(app, () => maintenance.sweep({ dryRun: true }));
    expect(detected).toMatchObject({ dryRun: true, stalePendingFiles: 1, orphanObjects: 1 });
    expect(storage.objects.has(orphanKey)).toBe(true);

    const report = await inTestTenant(app, () => maintenance.sweep());
    expect(report).toMatchObject({ dryRun: false, stalePendingFiles: 1, orphanObjects: 1 });
    const [row] = await db.select().from(files).where(eq(files.id, file.id));
    expect(row?.deletedAt).not.toBeNull();
    expect(storage.objects.has(`files/${file.id}`)).toBe(false);
    expect(storage.objects.has(orphanKey)).toBe(false);
  });

  describe('資料夾（docs/architecture/backend/09-file.md §4.2）', () => {
    interface FolderBody {
      id: string;
      name: string;
      parentId: string | null;
    }

    async function createFolder(token: string, name: string, parentId: string | null = null) {
      const response = await request(http)
        .post('/file-folders')
        .set('authorization', `Bearer ${token}`)
        .send({ name, parentId })
        .expect(201);
      return (response.body as { data: FolderBody }).data;
    }

    async function listIn(token: string, folderId: string) {
      const response = await request(http)
        .get('/files')
        .query({ folderId })
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      return (response.body as { data: { items: FileBody[] } }).data.items.map((f) => f.name);
    }

    it('上傳到資料夾、依 folderId 列出、移動檔案與資料夾', async () => {
      const token = await login(ADMIN);
      const art = await createFolder(token, 'art-move');
      const ui = await createFolder(token, 'ui', art.id);

      const { file, upload } = await startUpload(token, {
        name: 'button.png',
        contentType: 'text/plain',
        size: 5,
        folderId: ui.id,
      });
      storage.simulateBrowserUpload(upload.url, 5);
      await request(http)
        .post(`/files/${file.id}/complete`)
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      expect(await listIn(token, ui.id)).toEqual(['button.png']);
      expect(await listIn(token, 'root')).not.toContain('button.png');

      const moved = await request(http)
        .post('/files/move')
        .set('authorization', `Bearer ${token}`)
        .send({ fileIds: [file.id], folderIds: [ui.id], targetFolderId: null })
        .expect(200);
      expect((moved.body as { data: unknown }).data).toEqual({ movedFiles: 1, movedFolders: 1 });
      expect(await listIn(token, 'root')).toContain('button.png');

      const [row] = await db.select().from(fileFolders).where(eq(fileFolders.id, ui.id));
      expect(row?.parentId).toBeNull();
    });

    it('移到自己的子孫底下 → 422 FILE_FOLDER_CYCLE；同層同名（不分大小寫）→ 409', async () => {
      const token = await login(ADMIN);
      const a = await createFolder(token, 'cycle-a');
      const b = await createFolder(token, 'cycle-b', a.id);

      const cycle = await request(http)
        .post('/files/move')
        .set('authorization', `Bearer ${token}`)
        .send({ folderIds: [a.id], targetFolderId: b.id })
        .expect(422);
      expect((cycle.body as { error: { code: string } }).error.code).toBe('FILE_FOLDER_CYCLE');

      const duplicate = await request(http)
        .post('/file-folders')
        .set('authorization', `Bearer ${token}`)
        .send({ name: 'CYCLE-A', parentId: null })
        .expect(409);
      expect((duplicate.body as { error: { code: string } }).error.code).toBe(
        'FILE_FOLDER_NAME_CONFLICT',
      );
    });

    it('上傳資料夾：確保路徑時沿用同名資料夾，重送得到同樣的 id', async () => {
      const token = await login(ADMIN);
      const body = { parentId: null, paths: [['pack'], ['pack', 'sfx'], ['Pack', 'bgm', 'loop']] };
      const first = await request(http)
        .post('/file-folders/paths')
        .set('authorization', `Bearer ${token}`)
        .send(body)
        .expect(200);
      const second = await request(http)
        .post('/file-folders/paths')
        .set('authorization', `Bearer ${token}`)
        .send(body)
        .expect(200);
      expect(second.body).toEqual(first.body);

      const list = await request(http)
        .get('/file-folders')
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      const names = (list.body as { data: { items: FolderBody[] } }).data.items.map((f) => f.name);
      expect(names.filter((name) => name.toLowerCase() === 'pack')).toHaveLength(1);
      expect(names).toEqual(expect.arrayContaining(['sfx', 'bgm', 'loop']));
    });

    it('遞迴刪除：子資料夾與其中的檔案一起消失；刪除後可以再建同名資料夾', async () => {
      const token = await login(ADMIN);
      const top = await createFolder(token, 'trash-me');
      const child = await createFolder(token, 'child', top.id);
      const { file, upload } = await startUpload(token, {
        name: 'inside.txt',
        contentType: 'text/plain',
        size: 2,
        folderId: child.id,
      });
      storage.simulateBrowserUpload(upload.url, 2);
      await request(http)
        .post(`/files/${file.id}/complete`)
        .set('authorization', `Bearer ${token}`)
        .expect(200);

      await request(http)
        .delete(`/file-folders/${top.id}`)
        .set('authorization', `Bearer ${token}`)
        .expect(204);
      await request(http)
        .get(`/files/${file.id}`)
        .set('authorization', `Bearer ${token}`)
        .expect(404);
      const [row] = await db.select().from(fileFolders).where(eq(fileFolders.id, child.id));
      expect(row?.deletedAt).not.toBeNull();
      await createFolder(token, 'trash-me');
    });

    it('上傳到不存在的資料夾 → 404 FILE_FOLDER_NOT_FOUND', async () => {
      const token = await login(ADMIN);
      const response = await request(http)
        .post('/files')
        .set('authorization', `Bearer ${token}`)
        .send({
          name: 'x.txt',
          contentType: 'text/plain',
          size: 1,
          folderId: '99999999-9999-4999-8999-999999999999',
        })
        .expect(404);
      expect((response.body as { error: { code: string } }).error.code).toBe(
        'FILE_FOLDER_NOT_FOUND',
      );
    });

    it('auditor 能讀資料夾但不能建立或移動', async () => {
      const auditor = await login(AUDITOR);
      await request(http)
        .get('/file-folders')
        .set('authorization', `Bearer ${auditor}`)
        .expect(200);
      await request(http)
        .post('/file-folders')
        .set('authorization', `Bearer ${auditor}`)
        .send({ name: 'nope' })
        .expect(403);
      await request(http)
        .post('/files/move')
        .set('authorization', `Bearer ${auditor}`)
        .send({ fileIds: ['99999999-9999-4999-8999-999999999999'], targetFolderId: null })
        .expect(403);
    });

    it('資料夾不可以是自己的上層（資料表約束）', async () => {
      const [row] = await db.insert(fileFolders).values({ name: 'self' }).returning();
      await expectDbError(
        db
          .update(fileFolders)
          .set({ parentId: row?.id })
          .where(eq(fileFolders.id, row?.id ?? '')),
        /file_folders_not_own_parent/,
      );
    });
  });

  describe('files 資料表約束', () => {
    const base = { name: 'x', contentType: 'text/plain', storageKey: 'files/constraint' };

    it('ready 必須有 etag 與 uploaded_at', async () => {
      await expectDbError(
        db.insert(files).values({ ...base, size: 1, status: 'ready' }),
        /files_ready_confirmed/,
      );
    });

    it('影像變體 ready 必須有尺寸與主格式', async () => {
      await expectDbError(
        db.insert(files).values({ ...base, size: 1, variantStatus: 'ready' }),
        /files_variant_ready_described/,
      );
    });

    it('size 不可為負', async () => {
      await expectDbError(
        db.insert(files).values({ ...base, size: -1 }),
        /files_size_non_negative/,
      );
    });

    it('storage_key 唯一', async () => {
      await db.insert(files).values({ ...base, storageKey: 'files/dup', size: 1 });
      await expectDbError(
        db.insert(files).values({ ...base, storageKey: 'files/dup', size: 1 }),
        /files_storage_key_key/,
      );
    });
  });
});
