import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { ObjectStorage } from '@/core/storage';
import type {
  PresignDownloadOptions,
  PresignedRequest,
  PresignUploadOptions,
  StoredObjectHead,
} from '@/core/storage';
import { auditLogs, files, roles, userRoles, users } from '@/db/schema';

import type { TestDatabase } from './db';
import { createTestDatabase, expectDbError, truncateAll } from './db';

/**
 * 記憶體版的物件儲存：api 的整合測試不起 apps/file-storage（apps 之間不互相依賴），
 * 「瀏覽器直傳」以 `simulateBrowserUpload` 直接寫進來代替。
 * 與真實 S3 的相容性由 apps/file-storage 的測試（官方 SDK）負責。
 */
class InMemoryObjectStorage extends ObjectStorage {
  readonly objects = new Map<string, StoredObjectHead>();
  readonly deleted: string[] = [];

  async ensureBucket(): Promise<void> {}

  async ping(): Promise<boolean> {
    return true;
  }

  async head(key: string): Promise<StoredObjectHead | undefined> {
    return this.objects.get(key);
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
    this.deleted.push(key);
  }

  async presignUpload(key: string, options: PresignUploadOptions): Promise<PresignedRequest> {
    return {
      url: `http://storage.test/${key}?signed=put`,
      method: 'PUT',
      headers: { 'Content-Type': options.contentType },
      expiresAt: new Date(Date.now() + options.expiresIn * 1000),
    };
  }

  async presignDownload(key: string, options: PresignDownloadOptions): Promise<PresignedRequest> {
    return {
      url: `http://storage.test/${key}?signed=${options.disposition}`,
      method: 'GET',
      headers: {},
      expiresAt: new Date(Date.now() + options.expiresIn * 1000),
    };
  }

  /** 從 presigned URL 取出 key，模擬瀏覽器照著網址 PUT。 */
  simulateBrowserUpload(url: string, size: number): void {
    const key = new URL(url).pathname.slice(1);
    this.objects.set(key, { size, etag: 'etag-' + key, contentType: undefined });
  }
}

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
  url: string | null;
  downloadUrl: string | null;
  uploader: { displayName: string } | null;
}

async function startUpload(
  token: string,
  body: { name: string; contentType: string; size: number },
) {
  const response = await request(http)
    .post('/files')
    .set('authorization', `Bearer ${token}`)
    .send(body)
    .expect(201);
  return (response.body as { data: { file: FileBody; upload: { url: string; headers: object } } })
    .data;
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
    process.env.DATABASE_URL = inject('databaseUrl');
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN.email;
    process.env.SUPER_ADMIN_PASSWORD = SUPER_ADMIN.password;
    process.env.FILE_UPLOAD_MAX_SIZE = '1000';

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
    await app.close();
    await closeDb();
    delete process.env.FILE_UPLOAD_MAX_SIZE;
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

  it('auditor 能讀不能上傳；member 什麼都不能做', async () => {
    const auditor = await login(AUDITOR);
    await request(http).get('/files').set('authorization', `Bearer ${auditor}`).expect(200);
    await request(http)
      .post('/files')
      .set('authorization', `Bearer ${auditor}`)
      .send({ name: 'x.txt', contentType: 'text/plain', size: 1 })
      .expect(403);

    const member = await login(MEMBER);
    await request(http).get('/files').set('authorization', `Bearer ${member}`).expect(403);
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

  describe('files 資料表約束', () => {
    const base = { name: 'x', contentType: 'text/plain', storageKey: 'files/constraint' };

    it('ready 必須有 etag 與 uploaded_at', async () => {
      await expectDbError(
        db.insert(files).values({ ...base, size: 1, status: 'ready' }),
        /files_ready_confirmed/,
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
