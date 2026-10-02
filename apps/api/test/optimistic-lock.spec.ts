import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import type { Response } from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { relationTuples, roleHolderTuple, roles, users } from '@/db/schema';
import { hashPassword } from '@/modules/credential/password';

import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;
let token: string;

const ROOT = { email: 'lock-root@example.com', password: 'RootPassword!2026' };

interface VersionedBody {
  id: string;
  version: number;
}

function dataOf<T>(response: Response): T {
  return (response.body as { data: T }).data;
}

async function createUser(email: string, password: string | null = null): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({
      email,
      displayName: email,
      passwordHash: password ? await hashPassword(password) : null,
      status: 'active',
    })
    .returning();
  return user!.id;
}

async function createRole(name: string): Promise<string> {
  const response = await request(http)
    .post('/roles')
    .set('authorization', `Bearer ${token}`)
    .send({ name, permissionKeys: [] })
    .expect(201);
  return dataOf<VersionedBody>(response).id;
}

async function versionOfUser(id: string): Promise<number> {
  const [row] = await db.select({ version: users.version }).from(users).where(eq(users.id, id));
  return row!.version;
}

async function versionOfRole(id: string): Promise<number> {
  const [row] = await db.select({ version: roles.version }).from(roles).where(eq(roles.id, id));
  return row!.version;
}

function patchUser(id: string, body: Record<string, unknown>) {
  return request(http).patch(`/users/${id}`).set('authorization', `Bearer ${token}`).send(body);
}

function patchRole(id: string, body: Record<string, unknown>) {
  return request(http).patch(`/roles/${id}`).set('authorization', `Bearer ${token}`).send(body);
}

type Transaction = Parameters<Parameters<TestDatabase['transaction']>[0]>[0];

/**
 * 讓請求通過「讀到時的比對」之後卡在條件式 UPDATE 上，再搶先提交另一筆寫入：
 * 測試連線先鎖住該列，等請求的 UPDATE 在鎖上等待，遞增版本後提交。請求的 UPDATE 重新評估條件時就不命中
 * （docs/architecture/backend/14-revisions.md §9.2 D3 的「UPDATE 沒命中而列仍存在」路徑）。
 */
async function raceAfterRead(
  lock: (tx: Transaction) => Promise<unknown>,
  bump: (tx: Transaction) => Promise<unknown>,
  send: () => PromiseLike<Response>,
): Promise<Response> {
  let pending: Promise<Response> | undefined;
  await db.transaction(async (tx) => {
    await lock(tx);
    pending = Promise.resolve(send());
    await vi.waitFor(
      async () => {
        const [row] = await db.execute<{ waiting: number }>(
          sql`SELECT count(*)::int AS waiting FROM pg_stat_activity
            WHERE wait_event_type = 'Lock' AND datname = current_database()`,
        );
        expect(row?.waiting).toBeGreaterThan(0);
      },
      { timeout: 5_000, interval: 20 },
    );
    await bump(tx);
  });
  return pending!;
}

describe('樂觀鎖（docs/architecture/backend/14-revisions.md §9.2 D3、docs/architecture/backend/03-api-conventions.md §11）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = ROOT.email;
    process.env.SUPER_ADMIN_PASSWORD = ROOT.password;
    process.env.AUTH_RATE_LIMIT = '1000';

    const created = createTestDatabase();
    db = created.db;
    closeDb = async () => created.client.end();
    await truncateAll(db);
    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);

    const { AppModule } = await import('@/app.module');
    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();
    http = await listenOnLoopback(app);

    const login = await request(http).post('/auth/login').send(ROOT).expect(200);
    token = dataOf<{ accessToken: string }>(login).accessToken;
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
    delete process.env.AUTH_RATE_LIMIT;
  });

  describe('PATCH /users/:id', () => {
    it('詳情與列表帶 version；帶目前的版本更新 → 200，version 加一', async () => {
      const id = await createUser('lock-a@example.com');
      const detail = await request(http)
        .get(`/users/${id}`)
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      expect(dataOf<VersionedBody>(detail).version).toBe(1);
      const list = await request(http)
        .get('/users')
        .query({ keyword: 'lock-a@' })
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      expect(dataOf<{ items: VersionedBody[] }>(list).items[0]?.version).toBe(1);

      const updated = await patchUser(id, { displayName: 'A2', version: 1 }).expect(200);
      expect(dataOf<VersionedBody>(updated).version).toBe(2);
    });

    it('拿舊版本更新 → 409 USER_VERSION_CONFLICT（details.current），不覆寫', async () => {
      const id = await createUser('lock-b@example.com');
      await patchUser(id, { displayName: 'B-first', version: 1 }).expect(200);

      const stale = await patchUser(id, { displayName: 'B-stale', version: 1 }).expect(409);
      expect(stale.body).toMatchObject({
        error: { code: 'USER_VERSION_CONFLICT', details: { current: 2 } },
      });
      const [row] = await db.select().from(users).where(eq(users.id, id));
      expect(row).toMatchObject({ displayName: 'B-first', version: 2 });
    });

    it('同時用同一個版本送出：恰好一個成功，另一個 409 並帶成功後的版本', async () => {
      const id = await createUser('lock-c@example.com');
      const responses = await Promise.all([
        patchUser(id, { displayName: 'C-1', version: 1 }),
        patchUser(id, { displayName: 'C-2', version: 1 }),
      ]);
      const statuses = responses.map((response) => response.status).toSorted();
      expect(statuses).toEqual([200, 409]);
      const conflict = responses.find((response) => response.status === 409)!;
      expect(conflict.body).toMatchObject({
        error: { code: 'USER_VERSION_CONFLICT', details: { current: 2 } },
      });
      expect(await versionOfUser(id)).toBe(2);
    });

    it('PUT /users/:id/roles 不帶 expectedRoleIds → 400 VALIDATION_FAILED（R1b：必填）', async () => {
      const holder = await createUser('lock-expected@example.com');
      const response = await request(http)
        .put(`/users/${holder}/roles`)
        .set('authorization', `Bearer ${token}`)
        .send({ roleIds: [] })
        .expect(400);
      expect(response.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    });

    it('讀到之後、寫入之前被搶先改過（UPDATE 沒命中）→ 409，details.current 是重讀的版本', async () => {
      const id = await createUser('lock-h@example.com');
      const response = await raceAfterRead(
        (tx) => tx.select().from(users).where(eq(users.id, id)).for('update'),
        (tx) =>
          tx
            .update(users)
            .set({ displayName: 'H-other', version: sql`${users.version} + 1` })
            .where(eq(users.id, id)),
        () => patchUser(id, { displayName: 'H-mine', version: 1 }),
      );
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        error: { code: 'USER_VERSION_CONFLICT', details: { current: 2 } },
      });
      const [row] = await db.select().from(users).where(eq(users.id, id));
      expect(row?.displayName).toBe('H-other');
    });

    it('讀到之後、寫入之前被刪除 → 404 USER_NOT_FOUND', async () => {
      const id = await createUser('lock-i@example.com');
      const response = await raceAfterRead(
        (tx) => tx.select().from(users).where(eq(users.id, id)).for('update'),
        (tx) => tx.update(users).set({ deletedAt: new Date() }).where(eq(users.id, id)),
        () => patchUser(id, { displayName: 'I', version: 1 }),
      );
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ error: { code: 'USER_NOT_FOUND' } });
    });

    it('不帶 version → 400 VALIDATION_FAILED，不寫入（docs/architecture/backend/14-revisions.md §9.2 D4 的 R1b：必填）', async () => {
      const id = await createUser('lock-d@example.com');
      const response = await patchUser(id, { displayName: 'D-1' }).expect(400);
      expect(response.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
      const [row] = await db.select().from(users).where(eq(users.id, id));
      expect(row).toMatchObject({ displayName: 'lock-d@example.com', version: 1 });
    });

    it('只帶 version、沒有要改的欄位 → 400 VALIDATION_FAILED', async () => {
      const id = await createUser('lock-e@example.com');
      const response = await patchUser(id, { version: 1 }).expect(400);
      expect(response.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    });

    it('已刪除的使用者 → 404 USER_NOT_FOUND（不是版本衝突）', async () => {
      const id = await createUser('lock-f@example.com');
      await request(http)
        .delete(`/users/${id}`)
        .set('authorization', `Bearer ${token}`)
        .expect(204);
      const response = await patchUser(id, { displayName: 'F', version: 1 }).expect(404);
      expect(response.body).toMatchObject({ error: { code: 'USER_NOT_FOUND' } });
    });

    it('登入與角色指派不遞增 version；解鎖會', async () => {
      const password = 'LockPassword!2026';
      const id = await createUser('lock-g@example.com', password);
      await request(http)
        .post('/auth/login')
        .send({ email: 'lock-g@example.com', password })
        .expect(200);
      const [member] = await db.select().from(roles).where(eq(roles.slug, 'member'));
      await request(http)
        .put(`/users/${id}/roles`)
        .set('authorization', `Bearer ${token}`)
        .send({ roleIds: [member!.id], expectedRoleIds: [] })
        .expect(200);
      expect(await versionOfUser(id)).toBe(1);

      await db
        .update(users)
        .set({ lockedUntil: new Date(Date.now() + 60_000) })
        .where(eq(users.id, id));
      await request(http)
        .post(`/users/${id}/unlock`)
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      expect(await versionOfUser(id)).toBe(2);
    });
  });

  describe('PATCH /roles/:id', () => {
    it('詳情與列表帶 version；帶目前的版本更新 → 200，version 加一', async () => {
      const id = await createRole('Lock Role A');
      const detail = await request(http)
        .get(`/roles/${id}`)
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      expect(dataOf<VersionedBody>(detail).version).toBe(1);
      const list = await request(http)
        .get('/roles')
        .query({ keyword: 'Lock Role A' })
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      expect(dataOf<{ items: VersionedBody[] }>(list).items[0]?.version).toBe(1);

      const updated = await patchRole(id, { description: 'a', version: 1 }).expect(200);
      expect(dataOf<VersionedBody>(updated).version).toBe(2);
    });

    it('拿舊版本更新 → 409 ROLE_VERSION_CONFLICT（details.current），不覆寫', async () => {
      const id = await createRole('Lock Role B');
      await patchRole(id, { name: 'Lock Role B2', version: 1 }).expect(200);

      const stale = await patchRole(id, { name: 'Lock Role B3', version: 1 }).expect(409);
      expect(stale.body).toMatchObject({
        error: { code: 'ROLE_VERSION_CONFLICT', details: { current: 2 } },
      });
      const [row] = await db.select().from(roles).where(eq(roles.id, id));
      expect(row).toMatchObject({ name: 'Lock Role B2', version: 2 });
    });

    it('同時用同一個版本送出：恰好一個成功，另一個 409 並帶成功後的版本', async () => {
      const id = await createRole('Lock Role C');
      const responses = await Promise.all([
        patchRole(id, { description: 'c1', version: 1 }),
        patchRole(id, { description: 'c2', version: 1 }),
      ]);
      expect(responses.map((response) => response.status).toSorted()).toEqual([200, 409]);
      const conflict = responses.find((response) => response.status === 409)!;
      expect(conflict.body).toMatchObject({
        error: { code: 'ROLE_VERSION_CONFLICT', details: { current: 2 } },
      });
    });

    it('讀到之後、寫入之前被搶先改過（UPDATE 沒命中）→ 409，details.current 是重讀的版本', async () => {
      const id = await createRole('Lock Role G');
      const response = await raceAfterRead(
        (tx) => tx.select().from(roles).where(eq(roles.id, id)).for('update'),
        (tx) =>
          tx
            .update(roles)
            .set({ description: 'other', version: sql`${roles.version} + 1` })
            .where(eq(roles.id, id)),
        () => patchRole(id, { description: 'mine', version: 1 }),
      );
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        error: { code: 'ROLE_VERSION_CONFLICT', details: { current: 2 } },
      });
    });

    it('不帶 version → 400 VALIDATION_FAILED，不寫入（docs/architecture/backend/14-revisions.md §9.2 D4 的 R1b：必填）', async () => {
      const id = await createRole('Lock Role D');
      const response = await patchRole(id, { description: 'd1' }).expect(400);
      expect(response.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
      expect(await versionOfRole(id)).toBe(1);
    });

    it('已刪除的角色 → 404 ROLE_NOT_FOUND（不是版本衝突）', async () => {
      const id = await createRole('Lock Role E');
      await request(http)
        .delete(`/roles/${id}`)
        .set('authorization', `Bearer ${token}`)
        .expect(204);
      const response = await patchRole(id, { description: 'e', version: 1 }).expect(404);
      expect(response.body).toMatchObject({ error: { code: 'ROLE_NOT_FOUND' } });
    });

    it('權限鍵與持有者的寫入不遞增 version（關聯的寫入，docs/architecture/backend/14-revisions.md §9.2 D3）', async () => {
      const id = await createRole('Lock Role F');
      await request(http)
        .patch(`/roles/${id}/permissions`)
        .set('authorization', `Bearer ${token}`)
        .send({ add: ['user:read'] })
        .expect(200);
      const holder = await createUser('lock-holder@example.com');
      await db.insert(relationTuples).values(roleHolderTuple(id, holder));
      await request(http)
        .put(`/users/${holder}/roles`)
        .set('authorization', `Bearer ${token}`)
        .send({ roleIds: [], expectedRoleIds: [id] })
        .expect(200);
      expect(await versionOfRole(id)).toBe(1);
    });
  });
});
