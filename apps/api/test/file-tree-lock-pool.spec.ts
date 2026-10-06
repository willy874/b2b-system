import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { inject } from 'vitest';

import { ObjectStorage } from '@/core/storage';
import { relationTuples, roleHolderTuple, roles, users } from '@/db/schema';
import { PermissionService } from '@/modules/permission/permission.service';

import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';
import { InMemoryObjectStorage } from './in-memory-object-storage';
import { inTestTenant } from './tenant';

/**
 * 持有資料夾樹鎖的交易不能從連線池另取連線（docs/architecture/backend/09-file.md §11.1）。
 * 這個檔案把租戶的連線池縮到 2：設定在 import AppModule 之前（ConfigModule 在 import 時就讀 env），
 * 所以與其他檔案分開。
 */
let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;

const ROOT = { email: 'tree-lock-root@example.com', password: 'Quiet-Harbor-Lantern-26' };
const CREATOR = { email: 'tree-lock-creator@example.com', password: 'CreatorPassword!2026' };
const UPLOADER = { email: 'tree-lock-uploader@example.com', password: 'UploaderPassword!2026' };
/** 資料夾樹鎖的 key（file-folder.repository.ts 的 FOLDER_TREE_LOCK_KEY）。 */
const TREE_LOCK_KEY = 'file_folders_tree';

async function login(credentials: { email: string; password: string }): Promise<string> {
  const response = await request(http).post('/auth/login').send(credentials).expect(200);
  return (response.body as { data: { accessToken: string } }).data.accessToken;
}

async function createAdmin(credentials: { email: string; password: string }): Promise<string> {
  const { hashPassword } = await import('@/modules/credential/password');
  const [admin] = await db.select().from(roles).where(eq(roles.slug, 'admin'));
  const [user] = await db
    .insert(users)
    .values({
      email: credentials.email,
      displayName: credentials.email,
      passwordHash: await hashPassword(credentials.password),
      status: 'active',
    })
    .returning();
  await db.insert(relationTuples).values(roleHolderTuple(admin!.id, user!.id));
  return user!.id;
}

/** 等著拿資料夾樹鎖（advisory lock 還沒拿到）的連線數。 */
async function lockWaiters(): Promise<number> {
  const [row] = await db.execute<{ waiting: number }>(
    sql`SELECT count(*)::int AS waiting FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`,
  );
  return row?.waiting ?? 0;
}

describe('資料夾樹鎖與連線池（docs/architecture/backend/09-file.md §11.1）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = ROOT.email;
    process.env.SUPER_ADMIN_PASSWORD = ROOT.password;
    process.env.TENANT_POOL_MAX = '2';

    const created = createTestDatabase();
    db = created.db;
    closeDb = async () => created.client.end();
    await truncateAll(db);
    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);
    await createAdmin(CREATOR);
    await createAdmin(UPLOADER);

    const { AppModule } = await import('@/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ObjectStorage)
      .useValue(new InMemoryObjectStorage())
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    http = await listenOnLoopback(app);
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
    delete process.env.TENANT_POOL_MAX;
  });

  it('持鎖的建立資料夾不在交易內另取連線：權限剛失效、另一個交易佔著池裡最後一條連線等鎖，兩個請求都在幾秒內完成', async () => {
    const [creatorToken, uploaderToken] = [await login(CREATOR), await login(UPLOADER)];
    const folder = await request(http)
      .post('/file-folders')
      .set('authorization', `Bearer ${uploaderToken}`)
      .send({ name: '上傳目的地', parentId: null })
      .expect(201);
    const folderId = (folder.body as { data: { id: string } }).data.id;

    // 1. 連線池以外的一條連線拿著樹鎖
    const holder = postgres(inject('databaseUrl'), { max: 1, onnotice: () => {} });
    let release: (() => void) | undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: (() => void) | undefined;
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const holding = holder.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${TREE_LOCK_KEY}))`;
      locked?.();
      await released;
    });
    await lockTaken;

    try {
      const started = Date.now();
      // 2. 建立資料夾：通過 guard 之後佔著池裡的一條連線等鎖
      const create = request(http)
        .post('/file-folders')
        .set('authorization', `Bearer ${creatorToken}`)
        .send({ name: '持鎖時建立', parentId: null })
        .then((response) => response);
      await vi.waitFor(async () => expect(await lockWaiters()).toBe(1), { timeout: 5_000 });

      // 3. 整個租戶的權限快取失效：建立者拿到鎖之後若要重新載入權限，就得再取一條連線
      await inTestTenant(app, () => app.get(PermissionService).permissionsChanged());

      // 4. 上傳登記：佔著池裡最後一條連線，排在建立者之後等鎖
      const upload = request(http)
        .post('/files')
        .set('authorization', `Bearer ${uploaderToken}`)
        .send({ name: 'a.txt', contentType: 'text/plain', size: 10, folderId })
        .then((response) => response);
      await vi.waitFor(async () => expect(await lockWaiters()).toBe(2), { timeout: 5_000 });

      release?.();
      await holding;
      const [created, uploaded] = await Promise.all([create, upload]);
      expect(created.status).toBe(201);
      expect(uploaded.status).toBe(201);
      // 卡住的話要等 statement_timeout（15 秒）把等鎖的語句取消
      expect(Date.now() - started).toBeLessThan(10_000);
    } finally {
      release?.();
      await holding.catch(() => undefined);
      await holder.end();
    }
  });
});
