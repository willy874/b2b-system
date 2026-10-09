import { randomBytes } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import sharp from 'sharp';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PLATFORM_DB } from '@/core/database';
import type { PlatformDatabase } from '@/core/database';
import { nginxCdnSignature, ObjectStorage } from '@/core/storage';
import { relationTuples, roleHolderTuple, roles, users } from '@/db/schema';
import { FileImageService } from '@/modules/file/file-image.service';
import { FileObjectsService } from '@/modules/file/file-objects.service';
import { ImageProcessService } from '@/modules/image/image-process.service';

import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';
import { InMemoryObjectStorage } from './in-memory-object-storage';
import { inTestTenant, testTenantContext } from './tenant';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;
let bucket: string;
const storage = new InMemoryObjectStorage();

const CDN_ORIGIN = 'http://cdn.test:9080';
const SIGNING_KEY = randomBytes(48);
const SUPER_ADMIN = { email: 'cdn-root@example.com', password: 'Quiet-Harbor-Lantern-26' };
const ADMIN = { email: 'cdn-admin@example.com', password: 'AdminPassword!2026' };

async function login(credentials: { email: string; password: string }): Promise<string> {
  const response = await request(http).post('/auth/login').send(credentials).expect(200);
  return (response.body as { data: { accessToken: string } }).data.accessToken;
}

function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#336699' } })
    .png()
    .toBuffer();
}

/** 這個測試檔排入的 `cdn.purge`（平台 DB 由所有測試檔共用：以這次的 bucket 過濾）。 */
async function queuedPurges(): Promise<string[][]> {
  const rows = await app
    .get<PlatformDatabase>(PLATFORM_DB)
    .execute<{ data: { payload: { paths: string[] } } }>(
      sql`SELECT data FROM pgboss.job WHERE name = 'cdn.purge' ORDER BY created_on`,
    );
  return rows
    .map((row) => row.data.payload.paths)
    .filter((paths) => paths.some((path) => path.startsWith(`/storage/${bucket}/`)));
}

describe('圖片的 CDN（docs/architecture/backend/09-file.md §16）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN.email;
    process.env.SUPER_ADMIN_PASSWORD = SUPER_ADMIN.password;
    process.env.DEFAULT_RATE_LIMIT = '10000';
    process.env.FILE_CDN_ENABLED = 'true';
    process.env.FILE_CDN_ORIGIN = CDN_ORIGIN;
    process.env.FILE_CDN_SIGNING_KEYS = `c1:${SIGNING_KEY.toString('base64')}`;
    // 只開放檔案的影像變體：圖片資產照舊是 presigned（逐步開放，§17 D5）
    process.env.FILE_CDN_RESOURCES = 'fileVariant';
    process.env.FILE_CDN_PURGE_URL = 'http://cdn-purge.test:8081';
    process.env.FILE_CDN_PURGE_SECRET = randomBytes(48).toString('base64');

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
        displayName: 'cdn-admin',
        passwordHash: await hashPassword(ADMIN.password),
        status: 'active',
      })
      .returning();
    const [role] = await db.select().from(roles).where(eq(roles.slug, 'admin'));
    await db.insert(relationTuples).values(roleHolderTuple(role!.id, admin!.id));

    const { AppModule } = await import('@/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ObjectStorage)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    http = await listenOnLoopback(app);
    bucket = (await testTenantContext(app)).storageBucket;
  });

  afterAll(async () => {
    await app.get(FileImageService).whenIdle();
    await app.close();
    await closeDb();
    for (const key of [
      'DEFAULT_RATE_LIMIT',
      'FILE_CDN_ENABLED',
      'FILE_CDN_ORIGIN',
      'FILE_CDN_SIGNING_KEYS',
      'FILE_CDN_RESOURCES',
      'FILE_CDN_PURGE_URL',
      'FILE_CDN_PURGE_SECRET',
    ]) {
      delete process.env[key];
    }
  });

  let fileId: string;

  it('檔案的影像變體：影像 API 轉址到 CDN 網址（簽 exp 與完整路徑）；原圖原封不動時照舊 presigned', async () => {
    const token = await login(ADMIN);
    const content = await png(64, 48);
    const created = await request(http)
      .post('/files')
      .set('authorization', `Bearer ${token}`)
      .send({ name: 'sprite.png', contentType: 'image/png', size: content.length })
      .expect(201);
    const { file, upload } = (
      created.body as { data: { file: { id: string }; upload: { url: string } } }
    ).data;
    fileId = file.id;
    storage.write(new URL(upload.url).pathname.slice(1), content, 'image/png');
    await request(http)
      .post(`/files/${file.id}/complete`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    await inTestTenant(app, () => app.get(FileImageService).generateVariants(file.id));
    const detail = (
      await request(http)
        .get(`/files/${file.id}`)
        .set('authorization', `Bearer ${token}`)
        .expect(200)
    ).body as { data: { image: { previewUrl: string; originalUrl: string } } };

    const preview = await request(http)
      .get(detail.data.image.previewUrl.replace(/^\/api/, ''))
      .expect(302);
    const location = new URL(preview.headers.location ?? '');
    const path = `/storage/${bucket}/variants/${file.id}/preview.jpeg`;
    expect(location.origin).toBe(CDN_ORIGIN);
    expect(location.pathname).toBe(path);
    expect(location.searchParams.get('kid')).toBe('c1');
    const exp = Number(location.searchParams.get('exp'));
    expect(location.searchParams.get('sig')).toBe(nginxCdnSignature(SIGNING_KEY, path, exp));

    // 原圖原封不動（format 不指定）不是只寫一次的變體：不走 CDN
    const original = await request(http)
      .get(detail.data.image.originalUrl.replace(/^\/api/, ''))
      .expect(302);
    expect(original.headers.location).toMatch(/^http:\/\/storage\.test\/files\//);
  });

  it('沒開放的資源（圖片資產）照舊是 presigned', async () => {
    const token = await login(ADMIN);
    const content = await png(300, 300);
    const created = await request(http)
      .post('/images')
      .set('authorization', `Bearer ${token}`)
      .send({
        usage: 'user.avatar',
        name: 'me.png',
        contentType: 'image/png',
        size: content.length,
      })
      .expect(201);
    const { asset, upload } = (
      created.body as { data: { asset: { id: string }; upload: { url: string } } }
    ).data;
    storage.write(new URL(upload.url).pathname.slice(1), content, 'image/png');
    await request(http)
      .post(`/images/${asset.id}/complete`)
      .set('authorization', `Bearer ${token}`)
      .send({})
      .expect(200);
    await inTestTenant(app, () => app.get(ImageProcessService).process(asset.id));
    const ready = (
      await request(http)
        .get(`/images/${asset.id}`)
        .set('authorization', `Bearer ${token}`)
        .expect(200)
    ).body as { data: { image: { variants: Record<string, { src: string }> } } };
    expect(ready.data.image.variants.sm?.src).toMatch(/^http:\/\/storage\.test\/images\//);
  });

  it('永久刪除檔案的物件之後，排入 cdn.purge：變體的完整路徑（含 bucket），原檔不在其中', async () => {
    const before = await queuedPurges();
    await inTestTenant(app, () => app.get(FileObjectsService).deleteAll(fileId));
    const added = (await queuedPurges()).slice(before.length);

    expect(added).toHaveLength(1);
    expect(added[0]?.toSorted()).toEqual(
      [
        `/storage/${bucket}/variants/${fileId}/preview.jpeg`,
        `/storage/${bucket}/variants/${fileId}/thumbnail.jpeg`,
      ].toSorted(),
    );
    expect(storage.contents.has(`variants/${fileId}/preview.jpeg`)).toBe(false);
  });
});
