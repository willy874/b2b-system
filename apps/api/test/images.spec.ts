import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { and, eq, sql } from 'drizzle-orm';
import sharp from 'sharp';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PLATFORM_DB } from '@/core/database';
import type { PlatformDatabase } from '@/core/database';
import { ObjectStorage } from '@/core/storage';
import {
  auditLogs,
  files,
  fileStorageUsage,
  imageAssets,
  relationTuples,
  roleHolderTuple,
  roles,
  users,
} from '@/db/schema';
import { FileImageService } from '@/modules/file/file-image.service';
import { FileMaintenanceService } from '@/modules/file/file-maintenance.service';
import { ImageMaintenanceService } from '@/modules/image/image-maintenance.service';
import { ImageProcessService } from '@/modules/image/image-process.service';

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

const SUPER_ADMIN = { email: 'image-root@example.com', password: 'Quiet-Harbor-Lantern-26' };
const ADMIN = { email: 'image-admin@example.com', password: 'AdminPassword!2026' };
const MEMBER = { email: 'image-member@example.com', password: 'MemberPassword!2026' };

interface ImageSourcesBody {
  width: number;
  height: number;
  variants: Record<string, { src: string; srcSet: string; width: number; height: number }>;
}

interface AssetBody {
  id: string;
  status: string;
  failureReason: string | null;
  source: string;
  width: number | null;
  height: number | null;
  image: ImageSourcesBody | null;
  original: { url: string } | null;
  isInUse: boolean;
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

function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#336699' } })
    .png()
    .toBuffer();
}

/** 上傳一張圖並完成（還沒處理）。 */
async function uploadImage(token: string, content: Buffer, crop?: object): Promise<AssetBody> {
  const created = await request(http)
    .post('/images')
    .set('authorization', `Bearer ${token}`)
    .send({ usage: 'user.avatar', name: 'me.png', contentType: 'image/png', size: content.length })
    .expect(201);
  const { asset, upload } = (
    created.body as { data: { asset: AssetBody; upload: { url: string } } }
  ).data;
  storage.write(new URL(upload.url).pathname.slice(1), content, 'image/png');
  const completed = await request(http)
    .post(`/images/${asset.id}/complete`)
    .set('authorization', `Bearer ${token}`)
    .send(crop ? { crop } : {})
    .expect(200);
  return (completed.body as { data: AssetBody }).data;
}

/** 背景工作的本體（測試裡不起 worker）。 */
function processImage(id: string): Promise<void> {
  return inTestTenant(app, () => app.get(ImageProcessService).process(id));
}

async function getAsset(token: string, id: string): Promise<AssetBody> {
  const response = await request(http)
    .get(`/images/${id}`)
    .set('authorization', `Bearer ${token}`)
    .expect(200);
  return (response.body as { data: AssetBody }).data;
}

function setMyAvatar(token: string, body: object) {
  return request(http).patch('/auth/profile').set('authorization', `Bearer ${token}`).send(body);
}

async function myProfile(token: string) {
  const response = await request(http)
    .get('/auth/profile')
    .set('authorization', `Bearer ${token}`)
    .expect(200);
  return (
    response.body as {
      data: { user: { id: string; avatar: ImageSourcesBody | null; avatarImageId: string | null } };
    }
  ).data.user;
}

/** 計數等於 `SUM(files.size) + SUM(image_assets.size)`（租戶的容量，§15.2 D3）。 */
async function expectUsageConsistent(): Promise<void> {
  const [counted] = await db.select().from(fileStorageUsage);
  const [summed] = await db.execute<{ used: string }>(
    sql`SELECT (SELECT coalesce(sum(size), 0) FROM files) + (SELECT coalesce(sum(size), 0) FROM image_assets) AS used`,
  );
  expect(counted?.usedBytes).toBe(Number(summed?.used));
}

function errorCode(response: request.Response): string {
  return (response.body as { error: { code: string } }).error.code;
}

describe('圖片資產（docs/architecture/backend/25-image.md §15）', () => {
  let memberId: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN.email;
    process.env.SUPER_ADMIN_PASSWORD = SUPER_ADMIN.password;
    process.env.DEFAULT_RATE_LIMIT = '10000';
    process.env.IMAGE_MAINTENANCE_CRON = '';

    const created = createTestDatabase();
    db = created.db;
    closeDb = async () => created.client.end();
    await truncateAll(db);
    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);
    await createActiveUser(ADMIN.email, ADMIN.password, 'admin');
    memberId = (await createActiveUser(MEMBER.email, MEMBER.password, 'member')).id;

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
    delete process.env.DEFAULT_RATE_LIMIT;
    delete process.env.IMAGE_MAINTENANCE_CRON;
  });

  it('GET /images/usages：頭像的限制（登入即可）', async () => {
    const token = await login(MEMBER);
    const response = await request(http)
      .get('/images/usages')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const usages = (response.body as { data: { items: Array<{ id: string }> } }).data.items;
    expect(usages).toContainEqual(
      expect.objectContaining({
        id: 'user.avatar',
        aspectRatio: 1,
        minWidth: 128,
        presets: { sm: 32, md: 96, lg: 256 },
        sources: null,
      }),
    );
  });

  it('上傳 → 處理 → 設成自己的頭像：profile 帶各尺寸的網址，稽核記下來源；容量計數與合計一致', async () => {
    const token = await login(MEMBER);
    const asset = await uploadImage(token, await png(300, 200), {
      x: 0,
      y: 0,
      width: 0.6,
      height: 0.9,
    });
    expect(asset.status).toBe('pending');
    await expectUsageConsistent();

    await processImage(asset.id);
    const ready = await getAsset(token, asset.id);
    expect(ready).toMatchObject({ status: 'ready', width: 300, height: 200, isInUse: false });
    expect(ready.image?.variants.sm).toMatchObject({ width: 32, height: 32 });
    expect(storage.objects.has(`images/${asset.id}/upload`)).toBe(false);
    await expectUsageConsistent();

    await setMyAvatar(token, { avatarImageId: asset.id }).expect(200);
    const profile = await myProfile(token);
    expect(profile.avatarImageId).toBe(asset.id);
    expect(Object.keys(profile.avatar?.variants ?? {}).toSorted()).toEqual(['lg', 'md', 'sm']);
    expect(profile.avatar?.variants.md?.srcSet).toContain(`images/${asset.id}/r1/md.jpg`);

    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'user.update'), eq(auditLogs.resourceId, memberId)));
    expect(audit?.changes).toMatchObject({
      before: { avatarImageId: null },
      after: { avatarImageId: asset.id, avatarSource: 'upload' },
    });
  });

  it('一個資產只屬於一個資源：別人建立的當作不存在、已被使用的不能再拿去用', async () => {
    const member = await login(MEMBER);
    const admin = await login(ADMIN);
    const mine = (await myProfile(member)).avatarImageId;

    const theirs = await setMyAvatar(admin, { avatarImageId: mine });
    expect(theirs.status).toBe(404);
    expect(errorCode(theirs)).toBe('IMAGE_ASSET_NOT_FOUND');

    // 管理者把自己的頭像拿去幫別人設：已經被使用 → 409
    const adminAvatar = await uploadImage(admin, await png(200, 200));
    await processImage(adminAvatar.id);
    await setMyAvatar(admin, { avatarImageId: adminAvatar.id }).expect(200);
    const [target] = await db.select().from(users).where(eq(users.id, memberId));
    const reuse = await request(http)
      .patch(`/users/${memberId}`)
      .set('authorization', `Bearer ${admin}`)
      .send({ avatarImageId: adminAvatar.id, version: target?.version });
    expect(reuse.status).toBe(409);
    expect(errorCode(reuse)).toBe('IMAGE_ASSET_NOT_USABLE');

    // 換別人的頭像要 user:update：一般成員改不了別人的
    const forbidden = await request(http)
      .patch(`/users/${target?.id}`)
      .set('authorization', `Bearer ${member}`)
      .send({ avatarImageId: null, version: target?.version });
    expect(forbidden.status).toBe(403);
  });

  it('換掉頭像：舊的解除（保留到回收桶的保留期限），新的認領；重新裁切寫到新的版本', async () => {
    const token = await login(MEMBER);
    const before = (await myProfile(token)).avatarImageId;
    const next = await uploadImage(token, await png(400, 400));
    await processImage(next.id);
    await setMyAvatar(token, { avatarImageId: next.id }).expect(200);

    const [old] = await db
      .select()
      .from(imageAssets)
      .where(eq(imageAssets.id, before ?? ''));
    expect(old?.detachedAt).not.toBeNull();

    await setMyAvatar(token, { avatarCrop: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 } }).expect(
      200,
    );
    const [recropped] = await db.select().from(imageAssets).where(eq(imageAssets.id, next.id));
    expect(recropped).toMatchObject({ rev: 2, variantRev: 1 });
    await processImage(next.id);
    const profile = await myProfile(token);
    expect(profile.avatar?.variants.lg?.srcSet).toContain(`images/${next.id}/r2/lg.jpg`);
    expect(profile.avatar).toMatchObject({ width: 200, height: 200 });

    // 裁切之後太小 → 422
    const tooSmall = await setMyAvatar(token, {
      avatarCrop: { x: 0, y: 0, width: 0.1, height: 0.1 },
    });
    expect(errorCode(tooSmall)).toBe('IMAGE_TOO_SMALL');
  });

  it('從檔案管理挑選：以呼叫者的身分讀取、複製成新的資產，寫稽核 file.copy；看不到的檔案 → FILE_NOT_FOUND', async () => {
    const admin = await login(ADMIN);
    const member = await login(MEMBER);
    const content = await png(512, 512);
    const started = await request(http)
      .post('/files')
      .set('authorization', `Bearer ${admin}`)
      .send({ name: '團隊照.png', contentType: 'image/png', size: content.length })
      .expect(201);
    const { file, upload } = (
      started.body as { data: { file: { id: string }; upload: { url: string } } }
    ).data;
    storage.write(new URL(upload.url).pathname.slice(1), content, 'image/png');
    await request(http)
      .post(`/files/${file.id}/complete`)
      .set('authorization', `Bearer ${admin}`)
      .expect(200);
    await inTestTenant(app, () => app.get(FileImageService).generateVariants(file.id));

    // 選圖的列表只列能當頭像的
    const listed = await request(http)
      .get('/files?imageUsage=user.avatar')
      .set('authorization', `Bearer ${admin}`)
      .expect(200);
    expect(
      (listed.body as { data: { items: Array<{ id: string }> } }).data.items.map((item) => item.id),
    ).toContain(file.id);

    const copied = await request(http)
      .post('/images/from-source')
      .set('authorization', `Bearer ${admin}`)
      .send({ usage: 'user.avatar', source: 'file', refId: file.id })
      .expect(201);
    const asset = (copied.body as { data: AssetBody }).data;
    expect(asset.source).toBe('file');
    expect(storage.objects.has(`images/${asset.id}/upload`)).toBe(true);
    const [copyAudit] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'file.copy'), eq(auditLogs.resourceId, file.id)));
    expect(copyAudit?.changes).toEqual({ after: { purpose: 'imageAsset:user.avatar' } });

    // 原檔之後被刪除也不影響複製出去的圖
    await request(http)
      .delete(`/files/${file.id}`)
      .set('authorization', `Bearer ${admin}`)
      .expect(204);
    await processImage(asset.id);
    expect((await getAsset(admin, asset.id)).status).toBe('ready');

    // 一般成員看不到根目錄的檔案
    const denied = await request(http)
      .post('/images/from-source')
      .set('authorization', `Bearer ${member}`)
      .send({ usage: 'user.avatar', source: 'file', refId: file.id });
    expect(denied.status).toBe(404);
    expect(errorCode(denied)).toBe('FILE_NOT_FOUND');
    await expectUsageConsistent();
  });

  it('最近使用：自己的、同一個內容只列一次；選了之後複製成新的資產（沿用主檔）；可以移除', async () => {
    const token = await login(MEMBER);
    const recent = async () =>
      (
        (
          await request(http)
            .get('/images/recent?usage=user.avatar')
            .set('authorization', `Bearer ${token}`)
            .expect(200)
        ).body as { data: { items: AssetBody[] } }
      ).data.items;
    const before = await recent();
    expect(before.length).toBeGreaterThanOrEqual(2);
    const [latest] = before;

    const picked = await request(http)
      .post('/images/from-source')
      .set('authorization', `Bearer ${token}`)
      .send({ usage: 'user.avatar', source: 'recent', refId: latest?.id })
      .expect(201);
    const copy = (picked.body as { data: AssetBody }).data;
    await processImage(copy.id);
    // 內容雜湊相同：最近使用仍只列一次
    expect((await recent()).length).toBe(before.length);

    await request(http)
      .post(`/images/${copy.id}/hide-from-recent`)
      .set('authorization', `Bearer ${token}`)
      .expect(204);
    expect((await recent()).map((item) => item.id)).not.toContain(latest?.id);
  });

  it('處理失敗：SVG 偽裝成 PNG → failed（typeNotAllowed），不能拿來用', async () => {
    const token = await login(MEMBER);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"/>');
    const asset = await uploadImage(token, svg);
    await processImage(asset.id);
    expect(await getAsset(token, asset.id)).toMatchObject({
      status: 'failed',
      failureReason: 'typeNotAllowed',
    });
    const used = await setMyAvatar(token, { avatarImageId: asset.id });
    expect(errorCode(used)).toBe('IMAGE_ASSET_NOT_USABLE');
  });

  it('清理：沒被認領的 24 小時後、被換掉的回收桶保留期限後刪除；容量計數跟著釋出，檔案的對帳包含圖片資產', async () => {
    await db.execute(
      sql`UPDATE image_assets SET created_at = now() - interval '2 days' WHERE owner_id IS NULL`,
    );
    await db.execute(
      sql`UPDATE image_assets SET detached_at = now() - interval '400 days' WHERE detached_at IS NOT NULL`,
    );
    const doomed = (await db.select({ id: imageAssets.id }).from(imageAssets)).map((row) => row.id);
    const report = await inTestTenant(app, () => app.get(ImageMaintenanceService).sweep());
    expect(report.unclaimed).toBeGreaterThan(0);
    expect(report.detached).toBeGreaterThan(0);
    expect(report.failures).toBe(0);
    const remaining = await db.select().from(imageAssets);
    expect(remaining.every((row) => row.ownerId !== null && row.detachedAt === null)).toBe(true);
    for (const row of remaining) {
      expect([...storage.objects.keys()].some((key) => key.startsWith(`images/${row.id}/`))).toBe(
        true,
      );
    }
    await expectUsageConsistent();

    // 沒有 CDN（FILE_CDN_ENABLED 預設 false）：刪掉的物件不排入清理（docs/architecture/backend/09-file.md §16.4）
    const purges = await app
      .get<PlatformDatabase>(PLATFORM_DB)
      .execute<{ data: string }>(
        sql`SELECT data::text AS data FROM pgboss.job WHERE name = 'cdn.purge'`,
      );
    for (const id of doomed) {
      expect(purges.some((row) => row.data.includes(`images/${id}/`))).toBe(false);
    }

    // 檔案的對帳（SUM(files) ＋ 登記的其他合計）不會把圖片資產的大小算掉
    await db.update(fileStorageUsage).set({ reconciledAt: null });
    const fileReport = await inTestTenant(app, () => app.get(FileMaintenanceService).sweep());
    expect(fileReport.storageUsageDrift).toBe(0);
    expect(await db.select().from(files)).not.toHaveLength(0);
  });
});
