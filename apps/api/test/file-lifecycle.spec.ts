import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import sharp from 'sharp';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ObjectStorage } from '@/core/storage';
import {
  auditLogs,
  fileFolders,
  files,
  fileStorageUsage,
  relationTuples,
  roleHolderTuple,
  roles,
  users,
} from '@/db/schema';
import { FileImageService } from '@/modules/file/file-image.service';
import { FileMaintenanceService } from '@/modules/file/file-maintenance.service';
import { TrashService } from '@/modules/trash/trash.service';

import type { TestDatabase } from './db';
import { createTestDatabase, expectDbError, truncateAll } from './db';
import { listenOnLoopback } from './http';
import { InMemoryObjectStorage } from './in-memory-object-storage';
import { inTestTenant } from './tenant';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;
const storage = new InMemoryObjectStorage();

const SUPER_ADMIN = { email: 'file-root@example.com', password: 'Quiet-Harbor-Lantern-26' };
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
  const { hashPassword } = await import('@/modules/credential/password');
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
  await db.insert(relationTuples).values(roleHolderTuple(role!.id, user!.id));
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

/** 已用量的計數（`file_storage_usage`）與實際的 `SUM(size)`。 */
async function usage() {
  const [counted] = await db.select().from(fileStorageUsage);
  const [summed] = await db
    .select({ used: sql<string>`coalesce(sum(${files.size}), 0)::text` })
    .from(files);
  return { counted: counted?.usedBytes, summed: Number(summed?.used) };
}

/** 計數等於 `SUM(size)`（含上傳中與回收桶裡的），回傳目前的值。 */
async function expectConsistent(): Promise<number> {
  const { counted, summed } = await usage();
  expect(counted).toBe(summed);
  return summed;
}

describe('檔案生命週期（docs/architecture/backend/09-file.md）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN.email;
    process.env.SUPER_ADMIN_PASSWORD = SUPER_ADMIN.password;
    process.env.FILE_UPLOAD_MAX_SIZE = '1000';
    // 一個檔案裡的請求數會超過每人每分鐘的預設上限；限流不是這個檔案要測的
    process.env.DEFAULT_RATE_LIMIT = '10000';
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
    http = await listenOnLoopback(app);
  });

  afterAll(async () => {
    // 背景的影像變體產生要在關閉資料庫之前結束
    await app.get(FileImageService).whenIdle();
    await app.close();
    await closeDb();
    delete process.env.FILE_UPLOAD_MAX_SIZE;
    delete process.env.DEFAULT_RATE_LIMIT;
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

  it('HTML、SVG 不在租戶網域上 inline 提供', async () => {
    const token = await login(ADMIN);
    const html = await uploadFile(token, { name: 'evil.html', contentType: 'text/html', size: 10 });
    expect(html.url).toContain('signed=attachment&type=application/octet-stream');
    expect(html.downloadUrl).toContain('signed=attachment&type=application/octet-stream');
    const svg = await uploadFile(token, { name: 'a.svg', contentType: 'image/svg+xml', size: 10 });
    expect(svg.url).toContain('signed=attachment');
    expect(svg.url).not.toContain('type=');
    // 不留給後面依列表內容斷言的測試
    await Promise.all(
      [html.id, svg.id].map((id) =>
        request(http).delete(`/files/${id}`).set('authorization', `Bearer ${token}`).expect(204),
      ),
    );
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

  it('改名成含雙向文字控制字元（U+202E）的名稱 → 400 VALIDATION_FAILED，名稱不變（docs/architecture/backend/09-file.md §4）', async () => {
    const token = await login(ADMIN);
    const file = await uploadFile(token, {
      name: 'invoice.pdf',
      contentType: 'text/plain',
      size: 1,
    });
    const response = await request(http)
      .patch(`/files/${file.id}`)
      .set('authorization', `Bearer ${token}`)
      .send({ name: 'invoice\u202efdp.exe', version: file.version })
      .expect(400);
    expect((response.body as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
    const [row] = await db.select().from(files).where(eq(files.id, file.id));
    expect(row?.name).toBe('invoice.pdf');
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

  it('改名與刪除；刪除後 404，物件保留到永久刪除（docs/architecture/backend/14-revisions.md §9.2 D11）', async () => {
    const token = await login(ADMIN);
    const file = await uploadFile(token, { name: 'old.txt', contentType: 'text/plain', size: 3 });

    const renamed = await request(http)
      .patch(`/files/${file.id}`)
      .set('authorization', `Bearer ${token}`)
      .send({ name: 'new.txt', version: file.version })
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
    expect(storage.deleted).not.toContain(`files/${file.id}`);
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

  it('分塊上傳：物件儲存已組好、紀錄仍是 pending（上次在 markReady 前中斷）→ 重送 complete 成功', async () => {
    const token = await login(ADMIN);
    const { file } = await startUpload(token, {
      name: 'crashed.pak',
      contentType: 'application/octet-stream',
      size: 600,
    });
    const parts = await request(http)
      .post(`/files/${file.id}/parts`)
      .set('authorization', `Bearer ${token}`)
      .send({ partNumbers: [1] })
      .expect(200);
    const [part] = (parts.body as { data: { parts: Array<{ url: string }> } }).data.parts;
    storage.simulateBrowserUpload(part?.url ?? '', 600);
    const [row] = await db.select().from(files).where(eq(files.id, file.id));
    // 模擬「CompleteMultipartUpload 成功、markReady 之前程序當掉」：uploadId 在物件儲存那一側已失效
    await storage.completeMultipartUpload(row?.storageKey ?? '', row?.uploadId ?? '', [
      { partNumber: 1, etag: 'etag-1' },
    ]);

    const done = await request(http)
      .post(`/files/${file.id}/complete`)
      .set('authorization', `Bearer ${token}`)
      .send({ parts: [{ partNumber: 1, etag: 'etag-1' }] })
      .expect(200);
    expect((done.body as { data: FileBody }).data).toMatchObject({ status: 'ready', size: 600 });
    // 再重送一次：已經完成
    const again = await request(http)
      .post(`/files/${file.id}/complete`)
      .set('authorization', `Bearer ${token}`)
      .send({ parts: [{ partNumber: 1, etag: 'etag-1' }] })
      .expect(409);
    expect((again.body as { error: { code: string } }).error.code).toBe('FILE_ALREADY_UPLOADED');
    await request(http)
      .delete(`/files/${file.id}`)
      .set('authorization', `Bearer ${token}`)
      .expect(204);
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

  it('改名的樂觀鎖：拿舊版本改名 → 409 FILE_VERSION_CONFLICT，帶目前的版本', async () => {
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
    expect(stale.body).toMatchObject({
      error: { code: 'FILE_VERSION_CONFLICT', details: { current: 2 } },
    });
  });

  it('改名不帶 version → 400 VALIDATION_FAILED（docs/architecture/backend/14-revisions.md §9.2 D4 的 R1b：必填）', async () => {
    const token = await login(ADMIN);
    const file = await uploadFile(token, { name: 'nv.txt', contentType: 'text/plain', size: 1 });
    const response = await request(http)
      .patch(`/files/${file.id}`)
      .set('authorization', `Bearer ${token}`)
      .send({ name: 'nv2.txt' })
      .expect(400);
    expect(response.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
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
        ).body as {
          data: {
            items: FileBody[];
            nextCursor: string | null;
            pagination: { total: number | null };
          };
        }
      ).data;

    const first = await list({});
    expect(first.items.map((f) => f.name)).toEqual(['k4.txt', 'k3.txt']);
    expect(first.pagination.total).toBe(4);
    // 第一頁之後插入一筆較新的：offset 分頁會讓 k3 重複出現在第二頁
    await uploadFile(token, { name: 'k5.txt', contentType: 'text/x-keyset', size: 1 });
    const second = await list({ cursor: first.nextCursor ?? '' });
    expect(second.items.map((f) => f.name)).toEqual(['k2.txt', 'k1.txt']);
    // 帶游標的頁不重算總數
    expect(second.pagination.total).toBeNull();

    await request(http)
      .get('/files')
      .query({ cursor: first.nextCursor ?? '', sort: 'name' })
      .set('authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('prevCursor：往回取的頁與當初的一樣；中間有新增與刪除也不重複、不漏（docs/architecture/backend/09-file.md §6.1）', async () => {
    const token = await login(ADMIN);
    const uploaded: Record<string, string> = {};
    for (const name of ['p1.txt', 'p2.txt', 'p3.txt', 'p4.txt', 'p5.txt', 'p6.txt']) {
      uploaded[name] = (await uploadFile(token, { name, contentType: 'text/x-prev', size: 1 })).id;
    }
    const list = async (query: Record<string, string>) =>
      (
        (
          await request(http)
            .get('/files')
            .query({ contentType: 'text/x-prev', limit: '2', sort: 'name', ...query })
            .set('authorization', `Bearer ${token}`)
            .expect(200)
        ).body as {
          data: { items: FileBody[]; nextCursor: string | null; prevCursor: string | null };
        }
      ).data;
    const names = (page: { items: FileBody[] }) => page.items.map((file) => file.name);

    const first = await list({});
    expect(first.prevCursor).toBeNull();
    const second = await list({ cursor: first.nextCursor ?? '' });
    const third = await list({ cursor: second.nextCursor ?? '' });
    expect(names(third)).toEqual(['p5.txt', 'p6.txt']);

    // 從第三頁往回：與第二頁相同
    const back = await list({ cursor: third.prevCursor ?? '' });
    expect(names(back)).toEqual(['p3.txt', 'p4.txt']);

    // 第一頁的一筆被刪、另有一筆插進第一頁的範圍：往回取到最前面時只多那一筆、少被刪的那一筆
    await request(http)
      .delete(`/files/${uploaded['p1.txt']}`)
      .set('authorization', `Bearer ${token}`)
      .expect(204);
    await uploadFile(token, { name: 'p0.txt', contentType: 'text/x-prev', size: 1 });
    const front = await list({ cursor: back.prevCursor ?? '' });
    expect(names(front)).toEqual(['p0.txt', 'p2.txt']);
    // 這一頁剛好滿，還看不出是不是最前面：再往前是空的，prevCursor 為 null
    const beyond = await list({ cursor: front.prevCursor ?? '' });
    expect(beyond.items).toEqual([]);
    expect(beyond.prevCursor).toBeNull();
  });

  it('游標的值 Postgres 不接受（2 月 30 日）→ 400 VALIDATION_FAILED（docs/architecture/backend/09-file.md §6.1）', async () => {
    const token = await login(ADMIN);
    const cursor = Buffer.from(
      JSON.stringify([
        'createdAt',
        'desc',
        '2026-02-30T00:00:00.000000Z',
        '44444444-4444-4444-8444-444444444444',
      ]),
      'utf8',
    ).toString('base64url');
    const response = await request(http)
      .get('/files')
      .query({ sort: '-createdAt', cursor })
      .set('authorization', `Bearer ${token}`)
      .expect(400);
    expect(response.body).toMatchObject({
      error: { code: 'VALIDATION_FAILED', details: { field: 'cursor' } },
    });
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

    // 刪除後影像網址失效；變體與轉出的格式保留到永久刪除（docs/architecture/backend/14-revisions.md §9.2 D11，還原時不必重新產生）
    await request(http)
      .delete(`/files/${file.id}`)
      .set('authorization', `Bearer ${token}`)
      .expect(204);
    expect([...storage.objects.keys()].some((key) => key.startsWith(`variants/${file.id}/`))).toBe(
      true,
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

    it('移動後超過深度上限 → 400 VALIDATION_FAILED（子樹高度由遞迴 CTE 算出）', async () => {
      const token = await login(ADMIN);
      const ensure = async (path: string[]) => {
        const response = await request(http)
          .post('/file-folders/paths')
          .set('authorization', `Bearer ${token}`)
          .send({ parentId: null, paths: [path] })
          .expect(200);
        return (response.body as { data: { items: { id: string }[] } }).data.items[0]?.id ?? '';
      };
      const a = Array.from({ length: 20 }, (_, i) => `depth-a-${i}`);
      const b = Array.from({ length: 20 }, (_, i) => `depth-b-${i}`);
      const deepestA = await ensure(a);
      await ensure(b);
      const [rootB] = await db.select().from(fileFolders).where(eq(fileFolders.name, 'depth-b-0'));

      const tooDeep = await request(http)
        .post('/files/move')
        .set('authorization', `Bearer ${token}`)
        .send({ folderIds: [rootB?.id], targetFolderId: deepestA })
        .expect(400);
      expect((tooDeep.body as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
      const [unchanged] = await db
        .select()
        .from(fileFolders)
        .where(eq(fileFolders.id, rootB?.id ?? ''));
      expect(unchanged?.parentId).toBeNull();
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

  describe('已用量的計數（docs/architecture/05-tenancy.md §13.3 D8、migration 0036）', () => {
    it('登記、完成、放棄、刪除、還原、永久刪除之後，計數都等於 SUM(size)', async () => {
      const token = await login(ADMIN);
      const auth = { authorization: `Bearer ${token}` };
      const start = await expectConsistent();

      const kept = await uploadFile(token, { name: 'u1.bin', contentType: 'text/plain', size: 7 });
      expect(await expectConsistent()).toBe(start + 7);

      // 放棄上傳只是軟刪除：仍算在用量裡（永久刪除才釋出）
      const { file: abandoned } = await startUpload(token, {
        name: 'u2.bin',
        contentType: 'text/plain',
        size: 11,
      });
      expect(await expectConsistent()).toBe(start + 18);
      await request(http).delete(`/files/${abandoned.id}/upload`).set(auth).expect(204);
      expect(await expectConsistent()).toBe(start + 18);

      await request(http).delete(`/files/${kept.id}`).set(auth).expect(204);
      expect(await expectConsistent()).toBe(start + 18);
      await request(http).post(`/files/${kept.id}/restore`).set(auth).expect(200);
      expect(await expectConsistent()).toBe(start + 18);

      // 永久刪除（trash.purge）：兩個都在回收桶裡放超過保留期限
      await request(http).delete(`/files/${kept.id}`).set(auth).expect(204);
      await db
        .update(files)
        .set({ deletedAt: new Date(Date.now() - 400 * 86_400_000) })
        .where(sql`${files.id} IN (${kept.id}, ${abandoned.id})`);
      await inTestTenant(app, () => app.get(TrashService).purgeExpired());
      expect(await expectConsistent()).toBe(start);
    });

    it('登記失敗（資料夾不存在）→ 計數不變', async () => {
      const token = await login(ADMIN);
      const before = await expectConsistent();
      await request(http)
        .post('/files')
        .set('authorization', `Bearer ${token}`)
        .send({
          name: 'x.txt',
          contentType: 'text/plain',
          size: 5,
          folderId: '99999999-9999-4999-8999-999999999999',
        })
        .expect(404);
      expect(await expectConsistent()).toBe(before);
    });

    it('upload-policy 的 storageUsed 讀的是計數', async () => {
      const token = await login(ADMIN);
      await db.update(fileStorageUsage).set({ usedBytes: 12_345 });
      const response = await request(http)
        .get('/files/upload-policy')
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      expect((response.body as { data: { storageUsed: number } }).data.storageUsed).toBe(12_345);
    });

    it('維護排程的對帳：距上次超過一天才以 SUM(size) 修正偏差', async () => {
      const maintenance = app.get(FileMaintenanceService);
      const { summed } = await usage();
      await db
        .update(fileStorageUsage)
        .set({ usedBytes: summed + 99, reconciledAt: new Date(Date.now() - 2 * 86_400_000) });

      const report = await inTestTenant(app, () => maintenance.sweep());
      expect(report.storageUsageDrift).toBe(99);
      await expectConsistent();

      // 剛對帳過：這一輪不加總
      await db.update(fileStorageUsage).set({ usedBytes: summed + 1 });
      const next = await inTestTenant(app, () => maintenance.sweep());
      expect(next.storageUsageDrift).toBeNull();
      expect((await usage()).counted).toBe(summed + 1);
      await db.update(fileStorageUsage).set({ usedBytes: summed });
    });
  });

  describe('files 資料表約束', () => {
    const base = { name: 'x', contentType: 'text/plain', storageKey: 'files/constraint' };

    it('依上傳者篩選有部分索引（migration 0004）', async () => {
      const rows = await db.execute<{ indexdef: string }>(
        sql`SELECT indexdef FROM pg_indexes WHERE indexname = 'files_created_by_created_at_idx'`,
      );
      expect(rows[0]?.indexdef).toMatch(/\(created_by, created_at\) WHERE \(deleted_at IS NULL\)/);
    });

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
