import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ObjectStorage } from '@/core/storage';
import { relationTuples, roleHolderTuple, rolePermissionTuple, roles, users } from '@/db/schema';
import { FileImageService } from '@/modules/file/file-image.service';

import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';
import { InMemoryObjectStorage } from './in-memory-object-storage';

/**
 * 對外 API 的第一批 v1 端點（docs/architecture/06-external-api.md §9 T3）：檔案與資料夾、使用者唯讀。
 * 內部 api 與對外 API 兩個 app 共用一個 Postgres 與同一個（記憶體裡的）物件儲存。
 */

let internal: INestApplication;
let external: INestApplication;
let internalHttp: App;
let externalHttp: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;
const storage = new InMemoryObjectStorage();

const ROOT = { email: 'v1-root@example.com', password: 'Quiet-Harbor-Lantern-26' };
const ADMIN = { email: 'v1-admin@example.com', password: 'AdminPassword!2026' };
const ids: Record<string, string> = {};
const tokens: Record<string, string> = {};
let adminToken: string;

interface ExternalFile {
  id: string;
  status: string;
  folderId: string | null;
  url: string | null;
  downloadUrl: string | null;
}

interface ExternalUpload {
  file: ExternalFile;
  upload: { url: string; method: string; headers: Record<string, string> } | null;
  multipart: { partSize: number; partCount: number } | null;
}

function dataOf<T>(response: request.Response): T {
  return (response.body as { data: T }).data;
}

async function createApp(module: unknown): Promise<{ app: INestApplication; http: App }> {
  const moduleRef = await Test.createTestingModule({ imports: [module as never] })
    .overrideProvider(ObjectStorage)
    .useValue(storage)
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  return { app, http: await listenOnLoopback(app) };
}

function asAdmin() {
  const auth = { authorization: `Bearer ${adminToken}` };
  return {
    get: (path: string) => request(internalHttp).get(path).set(auth),
    post: (path: string, body?: object) => request(internalHttp).post(path).set(auth).send(body),
  };
}

function ext(token: string) {
  const auth = { authorization: `Bearer ${token}` };
  return {
    get: (path: string) => request(externalHttp).get(path).set(auth),
    post: (path: string, body?: object) => request(externalHttp).post(path).set(auth).send(body),
    delete: (path: string) => request(externalHttp).delete(path).set(auth),
  };
}

/** 以 admin 在內部 api 建服務帳號與 token；回傳完整的 token。 */
async function serviceAccountToken(
  name: string,
  roleIds: string[],
  scopes?: string[],
): Promise<{ accountId: string; token: string }> {
  const account = await asAdmin().post('/service-accounts', { name, roleIds }).expect(201);
  const accountId = dataOf<{ id: string }>(account).id;
  const created = await asAdmin()
    .post(`/service-accounts/${accountId}/tokens`, {
      name: 'v1',
      expiresInDays: 30,
      ...(scopes ? { scopes } : {}),
    })
    .expect(201);
  return { accountId, token: dataOf<{ token: string }>(created).token };
}

describe('對外 API v1：檔案與使用者（docs/architecture/06-external-api.md §9 T3）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = ROOT.email;
    process.env.SUPER_ADMIN_PASSWORD = ROOT.password;
    process.env.FILE_UPLOAD_MAX_SIZE = '1000';
    // 500 以上改用分塊上傳（每塊 8 MiB → 測試的檔案都只有一塊）
    process.env.FILE_MULTIPART_THRESHOLD = '500';

    const created = createTestDatabase();
    db = created.db;
    closeDb = async () => created.client.end();
    await truncateAll(db);
    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);

    const { hashPassword } = await import('@/modules/credential/password');
    const [admin] = await db
      .insert(users)
      .values({
        email: ADMIN.email,
        displayName: 'Admin',
        passwordHash: await hashPassword(ADMIN.password),
        status: 'active',
      })
      .returning();
    ids.admin = admin!.id;
    const [adminRole] = await db.select().from(roles).where(eq(roles.slug, 'admin'));
    await db.insert(relationTuples).values(roleHolderTuple(adminRole!.id, admin!.id));
    // 建置流程要的能力：全域的檔案讀寫，沒有 user:read
    const [filesRole] = await db
      .insert(roles)
      .values({ slug: 'v1-files', name: 'v1-files', isSystem: false })
      .returning();
    await db
      .insert(relationTuples)
      .values(['file:create', 'file:read'].map((key) => rolePermissionTuple(filesRole!.id, key)));
    ids.filesRole = filesRole!.id;
    const [auditorRole] = await db.select().from(roles).where(eq(roles.slug, 'auditor'));
    ids.auditorRole = auditorRole!.id;

    const { AppModule } = await import('@/app.module');
    ({ app: internal, http: internalHttp } = await createApp(AppModule));
    const { ExternalApiModule } = await import('@/external-api.module');
    ({ app: external, http: externalHttp } = await createApp(ExternalApiModule));

    const login = await request(internalHttp).post('/auth/login').send(ADMIN).expect(200);
    adminToken = dataOf<{ accessToken: string }>(login).accessToken;

    const builder = await serviceAccountToken('建置流程', [ids.filesRole]);
    ids.builder = builder.accountId;
    tokens.builder = builder.token;
    tokens.readOnly = (await serviceAccountToken('只讀', [ids.filesRole], ['file:read'])).token;
    const directory = await serviceAccountToken('目錄同步', [ids.auditorRole]);
    ids.directory = directory.accountId;
    tokens.directory = directory.token;
  });

  afterAll(async () => {
    // 背景的影像變體產生要在關閉資料庫之前結束
    await internal?.get(FileImageService).whenIdle();
    await external?.get(FileImageService).whenIdle();
    await external?.close();
    await internal?.close();
    await closeDb?.();
    delete process.env.FILE_UPLOAD_MAX_SIZE;
    delete process.env.FILE_MULTIPART_THRESHOLD;
  });

  describe('資料夾', () => {
    it('只列看得到內容的資料夾，並說明能不能上傳', async () => {
      const response = await ext(tokens.builder!).get('/v1/folders').expect(200);
      const list = dataOf<{
        items: { id: string; canUpload: boolean }[];
        canUploadToRoot: boolean;
      }>(response);
      expect(list.canUploadToRoot).toBe(true);
      expect(list.items.length).toBeGreaterThan(0);
      expect(Object.keys(list.items[0]!).toSorted()).toEqual(
        ['canUpload', 'id', 'kind', 'name', 'parentId'].toSorted(),
      );
    });
  });

  describe('上傳與下載', () => {
    it('單次上傳：建立 → PUT 到直傳網址 → complete；回應不含內部的影像網址與 capabilities', async () => {
      const started = await ext(tokens.builder!)
        .post('/v1/files', { name: 'build.log', contentType: 'text/plain', size: 120 })
        .expect(201);
      const { file, upload, multipart } = dataOf<ExternalUpload>(started);
      expect(file.status).toBe('pending');
      expect(multipart).toBeNull();
      expect(upload).toMatchObject({ method: 'PUT' });

      storage.simulateBrowserUpload(upload!.url, 120);
      const completed = await ext(tokens.builder!)
        .post(`/v1/files/${file.id}/complete`)
        .expect(200);
      const ready = dataOf<ExternalFile & Record<string, unknown>>(completed);
      expect(ready.status).toBe('ready');
      expect(ready.downloadUrl).toContain('signed=attachment');
      for (const internalOnly of ['image', 'capabilities', 'version']) {
        expect(ready).not.toHaveProperty(internalOnly);
      }
      ids.file = file.id;
    });

    it('檔案資訊與列表（游標分頁）', async () => {
      const info = await ext(tokens.builder!).get(`/v1/files/${ids.file}`).expect(200);
      expect(dataOf<ExternalFile>(info).id).toBe(ids.file);

      const page = await ext(tokens.builder!).get('/v1/files?folderId=root&limit=1').expect(200);
      const list = dataOf<{ items: ExternalFile[]; nextCursor: string | null }>(page);
      expect(list.items.map((item) => item.id)).toEqual([ids.file]);
    });

    it('分塊上傳：取得分塊網址 → 各自 PUT → 帶 ETag complete', async () => {
      const started = await ext(tokens.builder!)
        .post('/v1/files', {
          name: 'asset.bin',
          contentType: 'application/octet-stream',
          size: 600,
        })
        .expect(201);
      const { file, upload, multipart } = dataOf<ExternalUpload>(started);
      expect(upload).toBeNull();
      expect(multipart?.partCount).toBe(1);

      const parts = await ext(tokens.builder!)
        .post(`/v1/files/${file.id}/parts`, { partNumbers: [1] })
        .expect(200);
      const [part] = dataOf<{ parts: { partNumber: number; url: string }[] }>(parts).parts;
      storage.simulateBrowserUpload(part!.url, 600);

      const completed = await ext(tokens.builder!)
        .post(`/v1/files/${file.id}/complete`, { parts: [{ partNumber: 1, etag: 'etag-1' }] })
        .expect(200);
      expect(dataOf<ExternalFile>(completed).status).toBe('ready');
    });

    it('放棄上傳', async () => {
      const started = await ext(tokens.builder!)
        .post('/v1/files', { name: 'oops.txt', contentType: 'text/plain', size: 3 })
        .expect(201);
      const { file } = dataOf<ExternalUpload>(started);
      await ext(tokens.builder!).delete(`/v1/files/${file.id}/upload`).expect(204);
      await ext(tokens.builder!).get(`/v1/files/${file.id}`).expect(404);
    });

    it('對外上傳的檔案在內部 api 看得到（同一份資料）', async () => {
      await asAdmin().get(`/files/${ids.file}`).expect(200);
    });
  });

  describe('scopes 也限制檔案的全域權限（D3）', () => {
    it('帳號有全域 file:create、token 只給 file:read：讀得到，不能上傳', async () => {
      await ext(tokens.readOnly!).get(`/v1/files/${ids.file}`).expect(200);
      // file:read 帶出 file:access，路由的閘門會過；擋下的是 service 裡的資料夾判斷
      const response = await ext(tokens.readOnly!)
        .post('/v1/files', { name: 'x.txt', contentType: 'text/plain', size: 1 })
        .expect(403);
      expect(response.body).toMatchObject({ error: { code: 'AUTHZ_FORBIDDEN' } });
    });
  });

  describe('使用者（唯讀）', () => {
    it('沒有 user:read 的 token → 403', async () => {
      await ext(tokens.builder!).get('/v1/users').expect(403);
    });

    it('列表只有人，不含服務帳號；欄位是對外的契約', async () => {
      const response = await ext(tokens.directory!).get('/v1/users?limit=200').expect(200);
      const list = dataOf<{
        items: (Record<string, unknown> & { id: string })[];
        pagination: { total: number };
      }>(response);
      const listed = list.items.map((user) => user.id);
      expect(listed).toContain(ids.admin);
      expect(listed).not.toContain(ids.builder);
      expect(listed).not.toContain(ids.directory);
      for (const internalOnly of ['locale', 'timezone', 'version', 'lastLoginAt', 'lockedUntil']) {
        expect(list.items[0]).not.toHaveProperty(internalOnly);
      }
    });

    it('單一使用者；服務帳號的 id 回 404', async () => {
      await ext(tokens.directory!).get(`/v1/users/${ids.admin}`).expect(200);
      const response = await ext(tokens.directory!).get(`/v1/users/${ids.builder}`).expect(404);
      expect(response.body).toMatchObject({ error: { code: 'USER_NOT_FOUND' } });
    });
  });
});
