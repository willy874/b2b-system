import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { and, eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { inject } from 'vitest';

import { AUTHZ_REVISION_CHANNEL } from '@/core/authz';
import {
  authzRevision,
  isRolePermissionTuple,
  relationTuples,
  roleHolderTuple,
  rolePermissionTuple,
  roles,
  users,
} from '@/db/schema';

import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';
import { testTenantContext } from './tenant';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;
let tenantId: string;
/** 扮演「另一個程序」：直接連平台 DB 收發廣播。 */
let platform: postgres.Sql;
const received: Array<{ tenant: string; revision: number }> = [];

const SUPER_ADMIN = { email: 'root-rev@example.com', password: 'RootPassword!2026' };
const READER = { email: 'reader-rev@example.com', password: 'ReaderPassword!2026' };

async function revision(): Promise<number> {
  const [row] = await db.select().from(authzRevision);
  return row!.revision;
}

async function login(credentials: { email: string; password: string }): Promise<string> {
  const response = await request(http).post('/auth/login').send(credentials).expect(200);
  return (response.body as { data: { accessToken: string } }).data.accessToken;
}

describe('關係圖的 revision 與失效廣播（docs/rbac/01-domain-model.md §9.2 D7、D8）', () => {
  let readerRoleId: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN.email;
    process.env.SUPER_ADMIN_PASSWORD = SUPER_ADMIN.password;
    // TTL 拉長：證明失效靠的是廣播，不是快取過期
    process.env.PERMISSION_CACHE_TTL = '600';

    const created = createTestDatabase();
    db = created.db;
    closeDb = async () => created.client.end();
    await truncateAll(db);
    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);

    const { hashPassword } = await import('@/modules/credential/password');
    const [role] = await db
      .insert(roles)
      .values({ slug: 'reader-rev', name: 'Reader' })
      .returning();
    readerRoleId = role!.id;
    await db.insert(relationTuples).values(rolePermissionTuple(readerRoleId, 'user:read'));
    const [reader] = await db
      .insert(users)
      .values({
        email: READER.email,
        displayName: 'Reader',
        passwordHash: await hashPassword(READER.password),
        status: 'active',
      })
      .returning();
    await db.insert(relationTuples).values(roleHolderTuple(readerRoleId, reader!.id));

    platform = postgres(inject('platformDatabaseUrl'), { max: 1, onnotice: () => {} });
    await platform.listen(AUTHZ_REVISION_CHANNEL, (payload) => {
      received.push(JSON.parse(payload) as { tenant: string; revision: number });
    });

    const { AppModule } = await import('@/app.module');
    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();
    http = await listenOnLoopback(app);
    tenantId = (await testTenantContext(app)).id;
  });

  afterAll(async () => {
    await app.close();
    await platform.end();
    await closeDb();
  });

  it('relation_tuples 的每一條寫入語句讓 revision +1；一條語句寫多列只 +1', async () => {
    const start = await revision();
    await db
      .insert(relationTuples)
      .values([
        rolePermissionTuple(readerRoleId, 'role:read'),
        rolePermissionTuple(readerRoleId, 'auditLog:read'),
      ]);
    expect(await revision()).toBe(start + 1);
    await db
      .delete(relationTuples)
      .where(
        and(
          isRolePermissionTuple(),
          eq(relationTuples.subjectId, readerRoleId),
          sql`${relationTuples.relation} IN ('role:read', 'auditLog:read')`,
        ),
      );
    expect(await revision()).toBe(start + 2);
  });

  it('經 API 改角色的權限：提交後在平台 DB 廣播 { tenant, revision }', async () => {
    const token = await login(SUPER_ADMIN);
    await request(http)
      .patch(`/roles/${readerRoleId}/permissions`)
      .set('authorization', `Bearer ${token}`)
      .send({ add: ['role:read'], remove: [] })
      .expect(200);
    const current = await revision();
    await vi.waitFor(() =>
      expect(received).toContainEqual({ tenant: tenantId, revision: current }),
    );
  });

  it('其他程序改了關係圖並廣播：本機的權限快取跟著失效（不等 TTL）', async () => {
    const token = await login(READER);
    const list = () => request(http).get('/users').set('authorization', `Bearer ${token}`);
    expect((await list()).status).toBe(200);

    // 另一個程序的寫入：直接改 DB，本機沒有經手
    await db
      .delete(relationTuples)
      .where(
        and(
          isRolePermissionTuple(),
          eq(relationTuples.subjectId, readerRoleId),
          eq(relationTuples.relation, 'user:read'),
        ),
      );
    // 還沒收到廣播：本機仍用快取裡的舊權限
    expect((await list()).status).toBe(200);

    await platform.notify(
      AUTHZ_REVISION_CHANNEL,
      JSON.stringify({ tenant: tenantId, revision: await revision() }),
    );
    await vi.waitFor(async () => expect((await list()).status).toBe(403));
  });
});
