import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { and, eq, sql } from 'drizzle-orm';
import sharp from 'sharp';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DomainEvent, DomainEventBus } from '@/core/events';
import { parseExif } from '@/core/image';
import { SettingService } from '@/core/settings';
import { ObjectStorage } from '@/core/storage';
import { TENANT_FEATURES, TenantDirectory } from '@/core/tenant';
import type { TenantFeature } from '@/core/tenant';
import { tenants as platformTenants } from '@/db/platform/schema';
import {
  auditLogs,
  fileStorageUsage,
  galleryItems,
  relationTuples,
  roleHolderTuple,
  roles,
  users,
} from '@/db/schema';
import { FileImageService } from '@/modules/file/file-image.service';
import { GalleryMaintenanceService } from '@/modules/gallery/gallery-maintenance.service';
import { GalleryProcessService } from '@/modules/gallery/gallery-process.service';
import { TrashService } from '@/modules/trash/trash.service';

import type { TestDatabase } from './db';
import { createPlatformTestDatabase, createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';
import { InMemoryObjectStorage } from './in-memory-object-storage';
import { inTestTenant, testTenantContext } from './tenant';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;
const storage = new InMemoryObjectStorage();

const SUPER_ADMIN = { email: 'gallery-root@example.com', password: 'Quiet-Harbor-Lantern-26' };
const ADMIN = { email: 'gallery-admin@example.com', password: 'AdminPassword!2026' };
const MEMBER = { email: 'gallery-member@example.com', password: 'MemberPassword!2026' };

interface ItemBody {
  id: string;
  title: string;
  width: number;
  height: number;
  displayRotation: number;
  dominantColor: string | null;
  placeholder: string | null;
  takenAt: string | null;
  sortAt: string;
  version: number;
  image: {
    width: number;
    height: number;
    variants: Record<string, { src: string; srcSet: string }>;
  };
  tags: Array<{ id: string }>;
}

interface DetailBody extends ItemBody {
  exif: Record<string, unknown> | null;
  locationStripped: boolean;
  source: string;
  sourceName: string | null;
  albums: Array<{ id: string; name: string }>;
  duplicates: Array<{ id: string }>;
  original: { url: string } | null;
  download: { original: string; large: string };
}

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
      displayName: email.split('@')[0] ?? email,
      passwordHash: await hashPassword(password),
      status: 'active',
    })
    .returning();
  const [role] = await db.select().from(roles).where(eq(roles.slug, roleSlug));
  await db.insert(relationTuples).values(roleHolderTuple(role!.id, user!.id));
  return user!;
}

/** 帶 EXIF（含 GPS 與時區偏移）的 JPEG。 */
function photo(width: number, height: number, background = '#336699'): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background } })
    .jpeg()
    .withExif({
      IFD0: { Make: 'Acme', Model: 'X1' },
      IFD2: {
        DateTimeOriginal: '2026:03:14 10:20:30',
        OffsetTimeOriginal: '+08:00',
        FNumber: '28/10',
      },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '25/1 2/1 0/1' },
    })
    .toBuffer();
}

function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#993366' } })
    .png()
    .toBuffer();
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

function errorCode(response: request.Response): string {
  return (response.body as { error: { code: string } }).error.code;
}

function dataOf<T>(response: request.Response): T {
  return (response.body as { data: T }).data;
}

/** 背景工作的本體（測試裡不起 worker）。 */
function processItem(id: string): Promise<void> {
  return inTestTenant(app, () => app.get(GalleryProcessService).process(id));
}

/** 上傳一張並完成（還沒處理）。 */
async function upload(
  token: string,
  content: Buffer,
  fileName: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const created = await request(http)
    .post('/gallery/items')
    .set(auth(token))
    .send({ fileName, contentType: 'image/jpeg', size: content.length, ...extra })
    .expect(201);
  const { item, upload: target } = dataOf<{ item: { id: string }; upload: { url: string } }>(
    created,
  );
  storage.write(new URL(target.url).pathname.slice(1), content, 'image/jpeg');
  await request(http).post(`/gallery/items/${item.id}/complete`).set(auth(token)).expect(200);
  return item.id;
}

async function uploadAndProcess(token: string, content: Buffer, fileName: string, extra = {}) {
  const id = await upload(token, content, fileName, extra);
  await processItem(id);
  return id;
}

async function getItem(token: string, id: string): Promise<DetailBody> {
  return dataOf<DetailBody>(
    await request(http).get(`/gallery/items/${id}`).set(auth(token)).expect(200),
  );
}

async function listItems(
  token: string,
  query = '',
): Promise<{ items: ItemBody[]; nextCursor: string | null }> {
  return dataOf(await request(http).get(`/gallery/items${query}`).set(auth(token)).expect(200));
}

/** 計數等於 `SUM(files.size) + SUM(image_assets.size) + SUM(gallery_items.size)`（租戶的容量）。 */
async function expectUsageConsistent(): Promise<void> {
  const [counted] = await db.select().from(fileStorageUsage);
  const [summed] = await db.execute<{ used: string }>(
    sql`SELECT (SELECT coalesce(sum(size), 0) FROM files) + (SELECT coalesce(sum(size), 0) FROM image_assets) + (SELECT coalesce(sum(size), 0) FROM gallery_items) AS used`,
  );
  expect(counted?.usedBytes).toBe(Number(summed?.used));
}

async function setTenantFeatures(features: readonly TenantFeature[]): Promise<void> {
  const { id } = await testTenantContext(app);
  const platform = createPlatformTestDatabase();
  try {
    await platform.db
      .update(platformTenants)
      .set({ features: [...features] })
      .where(eq(platformTenants.id, id));
  } finally {
    await platform.client.end();
  }
  app.get(TenantDirectory).invalidate();
  app.get(DomainEventBus).publish(DomainEvent.TENANT_FEATURES_CHANGED, { tenantId: id });
}

describe('圖片庫（docs/architecture/backend/26-gallery.md）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN.email;
    process.env.SUPER_ADMIN_PASSWORD = SUPER_ADMIN.password;
    process.env.DEFAULT_RATE_LIMIT = '10000';
    process.env.GALLERY_MAINTENANCE_CRON = '';
    process.env.IMAGE_MAINTENANCE_CRON = '';

    const created = createTestDatabase();
    db = created.db;
    closeDb = async () => created.client.end();
    await truncateAll(db);
    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);
    await createActiveUser(ADMIN.email, ADMIN.password, 'admin');
    await createActiveUser(MEMBER.email, MEMBER.password, 'member');

    const { AppModule } = await import('@/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ObjectStorage)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    http = await listenOnLoopback(app);
    await setTenantFeatures(TENANT_FEATURES);
  });

  afterAll(async () => {
    await setTenantFeatures(TENANT_FEATURES);
    await app.get(FileImageService).whenIdle();
    await app.close();
    await closeDb();
    delete process.env.DEFAULT_RATE_LIMIT;
    delete process.env.GALLERY_MAINTENANCE_CRON;
    delete process.env.IMAGE_MAINTENANCE_CRON;
  });

  it('上傳 → 處理：讀 EXIF（拍攝時間換算成 UTC）、移除原檔的 GPS、產生變體與佔位；完成時才寫 galleryItem.create', async () => {
    const admin = await login(ADMIN);
    const id = await upload(admin, await photo(1600, 900), 'IMG_0001.JPG');
    // 還沒處理完：不在圖片庫
    expect((await listItems(admin)).items.map((item) => item.id)).not.toContain(id);
    const uploads = dataOf<{ processing: number }>(
      await request(http).get('/gallery/items/uploads').set(auth(admin)).expect(200),
    );
    expect(uploads.processing).toBeGreaterThanOrEqual(1);

    await processItem(id);
    const item = await getItem(admin, id);
    expect(item).toMatchObject({
      title: 'IMG_0001',
      width: 1600,
      height: 900,
      takenAt: '2026-03-14T02:20:30.000Z',
      sortAt: '2026-03-14T02:20:30.000Z',
      locationStripped: true,
      source: 'upload',
      exif: { make: 'Acme', model: 'X1', fNumber: 2.8 },
    });
    expect(item.exif).not.toHaveProperty('gps');
    expect(item.dominantColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(item.placeholder?.length).toBeGreaterThan(20);
    expect(Object.keys(item.image.variants).sort()).toEqual(['grid', 'large', 'medium']);
    expect(item.image.variants.grid?.srcSet).toMatch(/480w, .+ 1280w$/);
    expect(item.original).not.toBeNull();

    // 原檔：GPS 已清掉、其他 EXIF 保留；上傳的檔案已刪
    const original = storage.contents.get(`gallery/${id}/original`);
    const metadata = await sharp(original).metadata();
    expect(parseExif(metadata.exif)).toMatchObject({ make: 'Acme', hasGps: false });
    expect(storage.objects.has(`gallery/${id}/upload`)).toBe(false);
    expect(storage.objects.has(`gallery/${id}/r1/large.jpg`)).toBe(true);

    const [created] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'galleryItem.create'), eq(auditLogs.resourceId, id)));
    expect(created).toMatchObject({ actorEmail: ADMIN.email });
    expect(created?.changes).toMatchObject({ after: { source: 'upload', locationStripped: true } });
    await expectUsageConsistent();
  });

  it('系統設定 gallery.stripOriginalLocation 關掉時，原檔保留 GPS（D5）；exif 欄照樣不存 GPS', async () => {
    const admin = await login(ADMIN);
    const settings = app.get(SettingService);
    const { id: actorId } = (await db.select().from(users).where(eq(users.email, ADMIN.email)))[0]!;
    await inTestTenant(app, async () => {
      await settings.save('gallery.stripOriginalLocation', false, actorId);
      settings.invalidate();
    });
    try {
      const id = await uploadAndProcess(admin, await photo(300, 200), 'keep-gps.jpg');
      const item = await getItem(admin, id);
      expect(item.locationStripped).toBe(false);
      const metadata = await sharp(storage.contents.get(`gallery/${id}/original`)).metadata();
      expect(parseExif(metadata.exif).hasGps).toBe(true);
    } finally {
      await inTestTenant(app, async () => {
        await settings.reset('gallery.stripOriginalLocation');
        settings.invalidate();
      });
    }
  });

  it('型別與大小：HEIC 與 SVG 擋下（GALLERY_TYPE_NOT_ALLOWED）、超過上限 413；偽裝成 JPEG 的 SVG 處理失敗', async () => {
    const admin = await login(ADMIN);
    const heic = await request(http)
      .post('/gallery/items')
      .set(auth(admin))
      .send({ fileName: 'a.heic', contentType: 'image/heic', size: 100 });
    expect(heic.status).toBe(422);
    expect(errorCode(heic)).toBe('GALLERY_TYPE_NOT_ALLOWED');
    const huge = await request(http)
      .post('/gallery/items')
      .set(auth(admin))
      .send({ fileName: 'a.jpg', contentType: 'image/jpeg', size: 51 * 1024 * 1024 });
    expect(huge.status).toBe(413);
    expect(errorCode(huge)).toBe('GALLERY_ITEM_TOO_LARGE');

    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>');
    const id = await uploadAndProcess(admin, svg, 'fake.jpg');
    const uploads = dataOf<{ failed: Array<{ id: string; failureReason: string }> }>(
      await request(http).get('/gallery/items/uploads').set(auth(admin)).expect(200),
    );
    expect(uploads.failed).toContainEqual(
      expect.objectContaining({ id, failureReason: 'typeNotAllowed' }),
    );
    await request(http).delete('/gallery/items/uploads/failed').set(auth(admin)).expect(204);
    expect(
      dataOf<{ failed: unknown[] }>(
        await request(http).get('/gallery/items/uploads').set(auth(admin)).expect(200),
      ).failed,
    ).toEqual([]);
    await expectUsageConsistent();
  });

  it('權限：member 只能看（gallery:read）；上傳、建立相簿 403', async () => {
    const member = await login(MEMBER);
    await request(http).get('/gallery/items').set(auth(member)).expect(200);
    await request(http).get('/gallery/albums').set(auth(member)).expect(200);
    await request(http)
      .post('/gallery/items')
      .set(auth(member))
      .send({ fileName: 'a.jpg', contentType: 'image/jpeg', size: 10 })
      .expect(403);
    await request(http).post('/gallery/albums').set(auth(member)).send({ name: 'x' }).expect(403);
  });

  it('重複的圖片保留並標示（D7）', async () => {
    const admin = await login(ADMIN);
    const content = await photo(400, 300, '#118811');
    const first = await uploadAndProcess(admin, content, 'same-a.jpg');
    const second = await uploadAndProcess(admin, content, 'same-b.jpg');
    expect((await getItem(admin, second)).duplicates.map((item) => item.id)).toContain(first);
  });

  it('從檔案管理加入：複製（原檔刪除不影響）、略過不是圖片與已經加入過的、看不到的檔案；寫 file.copy', async () => {
    const admin = await login(ADMIN);
    const content = await png(300, 200);
    const uploadFile = async (name: string, body: Buffer, contentType: string) => {
      const started = await request(http)
        .post('/files')
        .set(auth(admin))
        .send({ name, contentType, size: body.length })
        .expect(201);
      const { file, upload: target } = dataOf<{ file: { id: string }; upload: { url: string } }>(
        started,
      );
      storage.write(new URL(target.url).pathname.slice(1), body, contentType);
      await request(http).post(`/files/${file.id}/complete`).set(auth(admin)).expect(200);
      return file.id;
    };
    const imageId = await uploadFile('設計稿.png', content, 'image/png');
    const pdfId = await uploadFile('說明.pdf', Buffer.from('%PDF-1.4'), 'application/pdf');

    // 選圖的過濾用途：檔案列表只列圖片庫收得下的
    const listed = dataOf<{ items: Array<{ id: string }> }>(
      await request(http).get('/files?imageUsage=gallery.item').set(auth(admin)).expect(200),
    );
    expect(listed.items.map((file) => file.id)).toContain(imageId);
    expect(listed.items.map((file) => file.id)).not.toContain(pdfId);
    // 過濾用途不能建立圖片資產
    await request(http)
      .post('/images/from-source')
      .set(auth(admin))
      .send({ usage: 'gallery.item', source: 'file', refId: imageId })
      .expect(400);

    const result = dataOf<{
      results: Array<{
        refId: string;
        status: string;
        reason: string | null;
        itemId: string | null;
      }>;
    }>(
      await request(http)
        .post('/gallery/items/from-source')
        .set(auth(admin))
        .send({ source: 'file', refIds: [imageId, pdfId, '00000000-0000-4000-8000-000000000000'] })
        .expect(200),
    );
    expect(result.results).toEqual([
      expect.objectContaining({ refId: imageId, status: 'added', reason: null }),
      expect.objectContaining({ refId: pdfId, status: 'skipped', reason: 'notFound' }),
      expect.objectContaining({ status: 'skipped', reason: 'notFound' }),
    ]);
    const itemId = result.results[0]?.itemId ?? '';
    const [copyAudit] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'file.copy'), eq(auditLogs.resourceId, imageId)));
    expect(copyAudit?.changes).toEqual({ after: { purpose: 'gallery' } });

    // 原檔刪除之後照樣處理得完
    await request(http).delete(`/files/${imageId}`).set(auth(admin)).expect(204);
    await processItem(itemId);
    expect(await getItem(admin, itemId)).toMatchObject({
      source: 'file',
      sourceName: '設計稿.png',
      title: '設計稿',
    });

    const again = dataOf<{
      results: Array<{ reason: string | null; existingItemId: string | null }>;
    }>(
      await request(http)
        .post('/gallery/items/from-source')
        .set(auth(admin))
        .send({ source: 'file', refIds: [imageId] })
        .expect(200),
    );
    // 原檔已刪除：已經加入過的判斷先於讀取
    expect(again.results[0]).toMatchObject({ reason: 'alreadyAdded', existingItemId: itemId });

    // 圖片庫自己不能當「其他來源」
    await request(http)
      .post('/gallery/items/from-source')
      .set(auth(admin))
      .send({ source: 'gallery', refIds: [itemId] })
      .expect(404);
    await expectUsageConsistent();
  });

  it('顯示方向：寫到新的版本、寬高互換、舊版本排入清理；版本不符 409', async () => {
    const admin = await login(ADMIN);
    const id = await uploadAndProcess(admin, await photo(800, 400), 'rotate.jpg');
    const before = await getItem(admin, id);
    const stale = await request(http)
      .patch(`/gallery/items/${id}`)
      .set(auth(admin))
      .send({ version: before.version + 5, title: 'x' });
    expect(stale.status).toBe(409);
    expect(errorCode(stale)).toBe('GALLERY_ITEM_VERSION_CONFLICT');

    await request(http)
      .patch(`/gallery/items/${id}`)
      .set(auth(admin))
      .send({ version: before.version, displayRotation: 90, title: '轉過的' })
      .expect(200);
    await processItem(id);
    const after = await getItem(admin, id);
    expect(after).toMatchObject({ width: 400, height: 800, displayRotation: 90, title: '轉過的' });
    // 調整過方向：原檔沒有轉，不給檢視器用
    expect(after.original).toBeNull();
    // 原圖比 large 小：large 與 medium 是同一個物件（只寫一份）
    expect(storage.objects.has(`gallery/${id}/r2/medium.jpg`)).toBe(true);
    expect(storage.objects.has(`gallery/${id}/r2/large.jpg`)).toBe(false);
    expect(storage.objects.has(`gallery/${id}/r1/medium.jpg`)).toBe(true);

    // 網址效期過後清掉舊版本
    await db
      .update(galleryItems)
      .set({ staleRevsPurgeAfter: new Date(Date.now() - 1000) })
      .where(eq(galleryItems.id, id));
    const report = await inTestTenant(app, () => app.get(GalleryMaintenanceService).sweep());
    expect(report.staleRevs).toBeGreaterThanOrEqual(1);
    expect(storage.objects.has(`gallery/${id}/r1/medium.jpg`)).toBe(false);
    expect(storage.objects.has(`gallery/${id}/r2/medium.jpg`)).toBe(true);
  });

  it('相簿：建立（名稱不分大小寫唯一）、加入與移出、封面與張數、篩選；刪除相簿不刪圖片，還原後關聯回來', async () => {
    const admin = await login(ADMIN);
    const album = dataOf<{ id: string; version: number }>(
      await request(http)
        .post('/gallery/albums')
        .set(auth(admin))
        .send({ name: '品牌素材' })
        .expect(201),
    );
    const duplicate = await request(http)
      .post('/gallery/albums')
      .set(auth(admin))
      .send({ name: '品牌素材' });
    expect(duplicate.status).toBe(409);
    expect(errorCode(duplicate)).toBe('GALLERY_ALBUM_NAME_DUPLICATE');

    const inAlbum = await uploadAndProcess(admin, await photo(300, 300), 'logo.jpg', {
      albumId: album.id,
    });
    const other = await uploadAndProcess(admin, await photo(300, 200), 'other.jpg');
    const added = dataOf<{ changed: number }>(
      await request(http)
        .post(`/gallery/albums/${album.id}/items`)
        .set(auth(admin))
        .send({ itemIds: [inAlbum, other] })
        .expect(200),
    );
    expect(added.changed).toBe(1);
    const albums = dataOf<{ items: Array<{ id: string; itemCount: number; cover: unknown }> }>(
      await request(http).get('/gallery/albums').set(auth(admin)).expect(200),
    );
    expect(albums.items.find((item) => item.id === album.id)).toMatchObject({ itemCount: 2 });
    expect(albums.items.find((item) => item.id === album.id)?.cover).not.toBeNull();

    const filtered = await listItems(admin, `?albumId=${album.id}`);
    expect(filtered.items.map((item) => item.id).sort()).toEqual([inAlbum, other].sort());
    expect((await getItem(admin, inAlbum)).albums).toEqual([{ id: album.id, name: '品牌素材' }]);

    const invalidCover = await request(http)
      .patch(`/gallery/albums/${album.id}`)
      .set(auth(admin))
      .send({ version: album.version, coverItemId: '00000000-0000-4000-8000-000000000000' });
    expect(errorCode(invalidCover)).toBe('GALLERY_ALBUM_COVER_INVALID');

    await request(http)
      .post(`/gallery/albums/${album.id}/items/remove`)
      .set(auth(admin))
      .send({ itemIds: [other] })
      .expect(200);
    expect((await listItems(admin, `?albumId=${album.id}`)).items.map((item) => item.id)).toEqual([
      inAlbum,
    ]);

    await request(http).delete(`/gallery/albums/${album.id}`).set(auth(admin)).expect(204);
    await getItem(admin, inAlbum);
    expect((await getItem(admin, inAlbum)).albums).toEqual([]);
    await request(http).post(`/gallery/albums/${album.id}/restore`).set(auth(admin)).expect(200);
    expect((await getItem(admin, inAlbum)).albums).toEqual([{ id: album.id, name: '品牌素材' }]);
  });

  it('閱覽：keyset 分頁不重複、時間軸的月份、前後一張、方向與關鍵字篩選', async () => {
    const admin = await login(ADMIN);
    const first = await listItems(admin, '?limit=2');
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await listItems(admin, `?limit=2&cursor=${first.nextCursor}`);
    const firstIds = first.items.map((item) => item.id);
    expect(second.items.every((item) => !firstIds.includes(item.id))).toBe(true);
    // 換了排序還拿舊游標：400
    await request(http)
      .get(`/gallery/items?sort=title:asc&cursor=${first.nextCursor}`)
      .set(auth(admin))
      .expect(400);

    const timeline = dataOf<{ timeZone: string; months: Array<{ month: string; count: number }> }>(
      await request(http).get('/gallery/items/timeline').set(auth(admin)).expect(200),
    );
    expect(timeline.months.find((month) => month.month === '2026-03')?.count).toBeGreaterThan(0);

    const all = await listItems(admin, '?limit=200');
    const middle = all.items[1];
    const neighbors = dataOf<{ previousId: string | null; nextId: string | null }>(
      await request(http)
        .get(`/gallery/items/${middle?.id}/neighbors`)
        .set(auth(admin))
        .expect(200),
    );
    expect(neighbors).toEqual({ previousId: all.items[0]?.id, nextId: all.items[2]?.id ?? null });

    const portrait = await listItems(admin, '?orientation=portrait');
    expect(portrait.items.every((item) => item.height > item.width)).toBe(true);
    const keyword = await listItems(admin, '?keyword=%E8%BD%89%E9%81%8E');
    expect(keyword.items.map((item) => item.title)).toEqual(['轉過的']);

    // 從某個月開始（日期捲軸）
    const startAt = await listItems(
      admin,
      `?startAt=${encodeURIComponent('2026-03-01T00:00:00Z')}`,
    );
    expect(startAt.items.every((item) => item.sortAt < '2026-03-01T00:00:00Z')).toBe(true);
  });

  it('標籤：資源類型 galleryItem、標籤組 gallery；以標籤篩選', async () => {
    const admin = await login(ADMIN);
    const tag = dataOf<{ id: string }>(
      await request(http)
        .post('/tags')
        .set(auth(admin))
        .send({ scope: 'gallery', name: '2026 春季' })
        .expect(201),
    );
    const id = (await listItems(admin, '?limit=1')).items[0]?.id ?? '';
    await request(http)
      .put(`/tags/assignments/galleryItem/${id}`)
      .set(auth(admin))
      .send({ tagIds: [tag.id] })
      .expect(200);
    const tagged = await listItems(admin, `?tagId=${tag.id}`);
    expect(tagged.items.map((item) => item.id)).toEqual([id]);
    expect(tagged.items[0]?.tags.map((item) => item.id)).toEqual([tag.id]);
    // member 看得到標籤，但不能貼
    const member = await login(MEMBER);
    await request(http).get('/tags?scope=gallery').set(auth(member)).expect(200);
    await request(http)
      .put(`/tags/assignments/galleryItem/${id}`)
      .set(auth(member))
      .send({ tagIds: [] })
      .expect(403);
  });

  it('選圖的來源 gallery：要 gallery:read，複製原檔成圖片資產並寫 galleryItem.copy', async () => {
    const member = await login(MEMBER);
    const id = (await listItems(member, '?imageUsage=user.avatar&limit=1')).items[0]?.id ?? '';
    const copied = dataOf<{ id: string; source: string }>(
      await request(http)
        .post('/images/from-source')
        .set(auth(member))
        .send({ usage: 'user.avatar', source: 'gallery', refId: id })
        .expect(201),
    );
    expect(copied.source).toBe('gallery');
    expect(storage.objects.has(`images/${copied.id}/upload`)).toBe(true);
    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'galleryItem.copy'), eq(auditLogs.resourceId, id)));
    expect(audit?.changes).toEqual({ after: { purpose: 'imageAsset:user.avatar' } });
  });

  it('刪除與回收桶：刪除後不在列表、還原後回來；到期永久刪除時物件與容量一起釋出', async () => {
    const admin = await login(ADMIN);
    const id = await uploadAndProcess(admin, await photo(200, 200), 'trash.jpg');
    await request(http).delete(`/gallery/items/${id}`).set(auth(admin)).expect(204);
    await request(http).get(`/gallery/items/${id}`).set(auth(admin)).expect(404);
    const trash = dataOf<{ items: Array<{ id: string }> }>(
      await request(http).get('/trash?type=galleryItem').set(auth(admin)).expect(200),
    );
    expect(trash.items.map((item) => item.id)).toContain(id);
    await request(http).post(`/gallery/items/${id}/restore`).set(auth(admin)).expect(200);
    await getItem(admin, id);

    await request(http).delete(`/gallery/items/${id}`).set(auth(admin)).expect(204);
    await db
      .update(galleryItems)
      .set({ deletedAt: new Date('2020-01-01') })
      .where(eq(galleryItems.id, id));
    const report = await inTestTenant(app, () => app.get(TrashService).purgeExpired());
    expect(report.purged.galleryItem).toBeGreaterThanOrEqual(1);
    expect([...storage.objects.keys()].some((key) => key.startsWith(`gallery/${id}/`))).toBe(false);
    await expectUsageConsistent();
  });

  it('清理：登記後一直沒完成的上傳在 24 小時後刪除並釋出容量', async () => {
    const admin = await login(ADMIN);
    const created = dataOf<{ item: { id: string } }>(
      await request(http)
        .post('/gallery/items')
        .set(auth(admin))
        .send({ fileName: 'never.jpg', contentType: 'image/jpeg', size: 1234 })
        .expect(201),
    );
    await db
      .update(galleryItems)
      .set({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(galleryItems.id, created.item.id));
    const report = await inTestTenant(app, () => app.get(GalleryMaintenanceService).sweep());
    expect(report.abandoned).toBeGreaterThanOrEqual(1);
    const [row] = await db.select().from(galleryItems).where(eq(galleryItems.id, created.item.id));
    expect(row).toBeUndefined();
    await expectUsageConsistent();
  });

  it('關掉 gallery：端點 404 FEATURE_DISABLED、選圖的來源也是；檔案管理照常', async () => {
    const admin = await login(ADMIN);
    const id = (await listItems(admin, '?limit=1')).items[0]?.id ?? '';
    await setTenantFeatures(TENANT_FEATURES.filter((feature) => feature !== 'gallery'));
    try {
      const disabled = await request(http).get('/gallery/items').set(auth(admin));
      expect(disabled.status).toBe(404);
      expect(errorCode(disabled)).toBe('FEATURE_DISABLED');
      const source = await request(http)
        .post('/images/from-source')
        .set(auth(admin))
        .send({ usage: 'user.avatar', source: 'gallery', refId: id });
      expect(errorCode(source)).toBe('FEATURE_DISABLED');
      const tags = await request(http).get('/tags?scope=gallery').set(auth(admin));
      expect(errorCode(tags)).toBe('FEATURE_DISABLED');
      await request(http).get('/files').set(auth(admin)).expect(200);
    } finally {
      await setTenantFeatures(TENANT_FEATURES);
    }
  });
});
