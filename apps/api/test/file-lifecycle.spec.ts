import { Readable } from 'node:stream';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { AppException } from '@/core/errors';
import { ObjectStorage } from '@/core/storage';
import type {
  CreateMultipartUploadOptions,
  ListedObject,
  PendingMultipartUpload,
  PresignDownloadOptions,
  PresignedRequest,
  PresignUploadOptions,
  StoredObjectHead,
  UploadedPart,
} from '@/core/storage';
import { auditLogs, files, roles, userRoles, users } from '@/db/schema';
import { FileImageService } from '@/modules/file/file-image.service';
import { FileMaintenanceService } from '@/modules/file/file-maintenance.service';

import type { TestDatabase } from './db';
import { createTestDatabase, expectDbError, truncateAll } from './db';

/**
 * 記憶體版的物件儲存：api 的整合測試不起 apps/file-storage（apps 之間不互相依賴），
 * 「瀏覽器直傳」以 `simulateBrowserUpload` 直接寫進來代替。
 * 與真實 S3 的相容性由 apps/file-storage 的測試（官方 SDK）負責。
 */
class InMemoryObjectStorage extends ObjectStorage {
  readonly objects = new Map<string, StoredObjectHead>();
  /** 有實際內容的物件（影像測試用）；其他物件只有 head，讀出來是全零。 */
  readonly contents = new Map<string, Buffer>();
  readonly modifiedAt = new Map<string, Date>();
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
    this.contents.delete(key);
    this.modifiedAt.delete(key);
    this.deleted.push(key);
  }

  async getObject(key: string): Promise<Readable | undefined> {
    const head = this.objects.get(key);
    if (!head) return undefined;
    return Readable.from([this.contents.get(key) ?? Buffer.alloc(head.size)]);
  }

  async putObject(key: string, body: Buffer, options: { contentType: string }): Promise<void> {
    this.write(key, body, options.contentType);
  }

  async *listObjects(prefix: string): AsyncIterable<ListedObject> {
    for (const [key, head] of [...this.objects].toSorted(([a], [b]) => a.localeCompare(b))) {
      if (!key.startsWith(prefix)) continue;
      yield { key, size: head.size, lastModified: this.modifiedAt.get(key) ?? new Date() };
    }
  }

  async *listMultipartUploads(prefix: string): AsyncIterable<PendingMultipartUpload> {
    for (const [uploadId, upload] of this.uploads) {
      if (upload.key.startsWith(prefix)) {
        yield { key: upload.key, uploadId, initiatedAt: upload.initiatedAt };
      }
    }
  }

  /** 寫入一個有內容的物件（模擬瀏覽器直傳真正的圖片）。 */
  write(key: string, body: Buffer, contentType: string): void {
    this.objects.set(key, { size: body.length, etag: `etag-${key}`, contentType });
    this.contents.set(key, body);
    this.modifiedAt.set(key, new Date());
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

  /** uploadId → { key, contentType, 已上傳的塊（塊號 → 大小） } */
  readonly uploads = new Map<
    string,
    { key: string; contentType: string; parts: Map<number, number>; initiatedAt: Date }
  >();

  async createMultipartUpload(key: string, options: CreateMultipartUploadOptions): Promise<string> {
    const uploadId = `upload-${this.uploads.size + 1}`;
    this.uploads.set(uploadId, {
      key,
      contentType: options.contentType,
      parts: new Map(),
      initiatedAt: new Date(),
    });
    return uploadId;
  }

  async presignUploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    options: { expiresIn: number },
  ): Promise<PresignedRequest> {
    return {
      url: `http://storage.test/${key}?uploadId=${uploadId}&partNumber=${partNumber}`,
      method: 'PUT',
      headers: {},
      expiresAt: new Date(Date.now() + options.expiresIn * 1000),
    };
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: readonly UploadedPart[],
  ): Promise<void> {
    const upload = this.uploads.get(uploadId);
    const missing = parts.some((part) => !upload?.parts.has(part.partNumber));
    if (!upload || upload.key !== key || missing) throw new AppException('FILE_UPLOAD_INCOMPLETE');
    const size = parts.reduce((sum, part) => sum + (upload.parts.get(part.partNumber) ?? 0), 0);
    this.objects.set(key, {
      size,
      etag: `etag-${key}-${parts.length}`,
      contentType: upload.contentType,
    });
    this.uploads.delete(uploadId);
  }

  async abortMultipartUpload(_key: string, uploadId: string): Promise<void> {
    this.uploads.delete(uploadId);
  }

  /** 從 presigned URL 取出 key，模擬瀏覽器照著網址 PUT（分塊網址則記下那一塊）。 */
  simulateBrowserUpload(url: string, size: number, contentType?: string): void {
    const parsed = new URL(url);
    const uploadId = parsed.searchParams.get('uploadId');
    if (uploadId) {
      this.uploads.get(uploadId)?.parts.set(Number(parsed.searchParams.get('partNumber')), size);
      return;
    }
    const key = parsed.pathname.slice(1);
    this.objects.set(key, { size, etag: 'etag-' + key, contentType });
    this.modifiedAt.set(key, new Date());
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
    process.env.DATABASE_URL = inject('databaseUrl');
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
    const detected = await maintenance.sweep({ dryRun: true });
    expect(detected).toMatchObject({ dryRun: true, stalePendingFiles: 1, orphanObjects: 1 });
    expect(storage.objects.has(orphanKey)).toBe(true);

    const report = await maintenance.sweep();
    expect(report).toMatchObject({ dryRun: false, stalePendingFiles: 1, orphanObjects: 1 });
    const [row] = await db.select().from(files).where(eq(files.id, file.id));
    expect(row?.deletedAt).not.toBeNull();
    expect(storage.objects.has(`files/${file.id}`)).toBe(false);
    expect(storage.objects.has(orphanKey)).toBe(false);
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
