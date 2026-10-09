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
import { ObjectStorage } from '@/core/storage';
import { galleryItems } from '@/db/schema';
import { FileImageService } from '@/modules/file/file-image.service';
import { GalleryMaintenanceService } from '@/modules/gallery/gallery-maintenance.service';
import { GalleryProcessService } from '@/modules/gallery/gallery-process.service';
import { TrashService } from '@/modules/trash/trash.service';

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
const SUPER_ADMIN = { email: 'gallery-cdn-root@example.com', password: 'Quiet-Harbor-Lantern-26' };

interface DetailBody {
  id: string;
  version: number;
  image: { variants: Record<string, { src: string; srcSet: string }> };
  original: { url: string } | null;
  download: { original: string; large: string };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

function dataOf<T>(response: request.Response): T {
  return (response.body as { data: T }).data;
}

async function login(): Promise<string> {
  const response = await request(http).post('/auth/login').send(SUPER_ADMIN).expect(200);
  return dataOf<{ accessToken: string }>(response).accessToken;
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
    .filter((paths) => paths.some((path) => path.startsWith(`/storage/${bucket}/gallery/`)));
}

/** 上傳一張 JPEG 並處理完成（測試裡不起 worker）。 */
async function uploadAndProcess(token: string, fileName: string): Promise<string> {
  const content = await sharp({
    create: { width: 800, height: 400, channels: 3, background: '#336699' },
  })
    .jpeg()
    .toBuffer();
  const created = await request(http)
    .post('/gallery/items')
    .set(auth(token))
    .send({ fileName, contentType: 'image/jpeg', size: content.length })
    .expect(201);
  const { item, upload } = dataOf<{ item: { id: string }; upload: { url: string } }>(created);
  storage.write(new URL(upload.url).pathname.slice(1), content, 'image/jpeg');
  await request(http).post(`/gallery/items/${item.id}/complete`).set(auth(token)).expect(200);
  await inTestTenant(app, () => app.get(GalleryProcessService).process(item.id));
  return item.id;
}

async function getItem(token: string, id: string): Promise<DetailBody> {
  return dataOf(await request(http).get(`/gallery/items/${id}`).set(auth(token)).expect(200));
}

/** 這張圖在物件儲存裡的變體（`gallery/<id>/r<rev>/…`），換成 CDN 清理的完整路徑。 */
function variantPaths(id: string, rev: number): string[] {
  return [...storage.objects.keys()]
    .filter((key) => key.startsWith(`gallery/${id}/r${rev}/`))
    .map((key) => `/storage/${bucket}/${key}`)
    .toSorted();
}

describe('圖片庫接上 CDN（docs/architecture/backend/26-gallery.md §6、§11.5；09-file.md §16）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN.email;
    process.env.SUPER_ADMIN_PASSWORD = SUPER_ADMIN.password;
    process.env.DEFAULT_RATE_LIMIT = '10000';
    process.env.GALLERY_MAINTENANCE_CRON = '';
    process.env.FILE_CDN_ENABLED = 'true';
    process.env.FILE_CDN_ORIGIN = CDN_ORIGIN;
    process.env.FILE_CDN_SIGNING_KEYS = `c1:${randomBytes(48).toString('base64')}`;
    process.env.FILE_CDN_RESOURCES = 'galleryItem';
    process.env.FILE_CDN_PURGE_URL = 'http://cdn-purge.test:8081';
    process.env.FILE_CDN_PURGE_SECRET = randomBytes(48).toString('base64');

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
    bucket = (await testTenantContext(app)).storageBucket;
  });

  afterAll(async () => {
    await app.get(FileImageService).whenIdle();
    await app.close();
    await closeDb();
    for (const key of [
      'DEFAULT_RATE_LIMIT',
      'GALLERY_MAINTENANCE_CRON',
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

  it('變體的網址走 CDN；原檔的 inline 與下載照舊是 presigned', async () => {
    const token = await login();
    const id = await uploadAndProcess(token, 'cdn-photo.jpg');
    const item = await getItem(token, id);

    for (const variant of Object.values(item.image.variants)) {
      expect(variant.src.startsWith(`${CDN_ORIGIN}/storage/${bucket}/gallery/${id}/r1/`)).toBe(
        true,
      );
    }
    expect(item.original?.url.startsWith(CDN_ORIGIN)).toBe(false);
    expect(item.download.original.startsWith(CDN_ORIGIN)).toBe(false);
    expect(item.download.large.startsWith(CDN_ORIGIN)).toBe(false);
  });

  it('調整方向後，清理排程刪掉舊版本的變體，排入 cdn.purge（只有舊版本）', async () => {
    const token = await login();
    const id = await uploadAndProcess(token, 'rotate.jpg');
    const oldPaths = variantPaths(id, 1);
    expect(oldPaths.length).toBeGreaterThan(0);
    const before = await getItem(token, id);
    await request(http)
      .patch(`/gallery/items/${id}`)
      .set(auth(token))
      .send({ version: before.version, displayRotation: 90 })
      .expect(200);
    await inTestTenant(app, () => app.get(GalleryProcessService).process(id));
    await db
      .update(galleryItems)
      .set({ staleRevsPurgeAfter: new Date(Date.now() - 1000) })
      .where(eq(galleryItems.id, id));

    const queued = (await queuedPurges()).length;
    await inTestTenant(app, () => app.get(GalleryMaintenanceService).sweep());
    const added = (await queuedPurges()).slice(queued).flat().toSorted();

    expect(added).toEqual(oldPaths);
    expect(variantPaths(id, 2).length).toBeGreaterThan(0);
  });

  it('回收桶到期永久刪除：物件刪掉之後排入 cdn.purge，只有變體、沒有原檔', async () => {
    const token = await login();
    const id = await uploadAndProcess(token, 'purge.jpg');
    const paths = variantPaths(id, 1);
    await request(http).delete(`/gallery/items/${id}`).set(auth(token)).expect(204);
    await db
      .update(galleryItems)
      .set({ deletedAt: new Date('2020-01-01') })
      .where(eq(galleryItems.id, id));

    const queued = (await queuedPurges()).length;
    await inTestTenant(app, () => app.get(TrashService).purgeExpired());
    const added = (await queuedPurges()).slice(queued).flat().toSorted();

    expect(added).toEqual(paths);
    expect(added.some((path) => path.endsWith(`gallery/${id}/original`))).toBe(false);
    expect([...storage.objects.keys()].some((key) => key.startsWith(`gallery/${id}/`))).toBe(false);
  });
});
