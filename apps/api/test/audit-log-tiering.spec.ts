import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { auditLogs, auditLogsArchive } from '@/db/schema';

import type { TestDatabase } from './db';
import { createTestDatabase, expectDbError, truncateAll } from './db';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;
let token: string;

const SUPER_ADMIN = { email: 'root@example.com', password: 'RootPassword!2026' };
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);

interface ListBody {
  data: {
    items: Array<Record<string, unknown> & { id: string; action: string }>;
    pagination: { total: number };
  };
}

function list(query: string) {
  return request(http).get(`/audit-logs?${query}`).set('authorization', `Bearer ${token}`);
}

async function insertLog(action: string, occurredAt: Date) {
  const [row] = await db
    .insert(auditLogs)
    .values({
      occurredAt,
      actorEmail: 'tier@example.com',
      action,
      resourceType: 'tier',
      result: 'success',
      changes: { before: { name: 'a' }, after: { name: 'b' } },
    })
    .returning();
  return row!;
}

async function archive(cutoff: Date, batchSize = 1000): Promise<number> {
  const [row] = await db.execute<{ moved: number }>(
    sql`SELECT archive_audit_logs(${cutoff.toISOString()}::timestamptz, ${batchSize}) AS moved`,
  );
  return Number(row?.moved ?? 0);
}

describe('稽核日誌冷熱分層（docs/architecture/backend/06-audit-log.md §8）', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = inject('databaseUrl');
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN.email;
    process.env.SUPER_ADMIN_PASSWORD = SUPER_ADMIN.password;

    const created = createTestDatabase();
    db = created.db;
    closeDb = async () => created.client.end();
    await truncateAll(db);

    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);

    const { AppModule } = await import('@/app.module');
    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();
    http = app.getHttpServer() as App;

    const login = await request(http).post('/auth/login').send(SUPER_ADMIN).expect(200);
    token = (login.body as { data: { accessToken: string } }).data.accessToken;

    await insertLog('tier.recent', daysAgo(1));
    await insertLog('tier.old', daysAgo(100));
    await insertLog('tier.older', daysAgo(120));
    await insertLog('tier.ancient', daysAgo(400));
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  describe('archive_audit_logs()', () => {
    it('只搬早於 cutoff 的紀錄，分批搬到回傳 0 為止', async () => {
      expect(await archive(daysAgo(90), 2)).toBe(2);
      expect(await archive(daysAgo(90), 2)).toBe(1);
      expect(await archive(daysAgo(90), 2)).toBe(0);

      const hot = await db.select({ action: auditLogs.action }).from(auditLogs);
      const cold = await db.select({ action: auditLogsArchive.action }).from(auditLogsArchive);
      expect(hot.map((row) => row.action)).toContain('tier.recent');
      expect(hot.map((row) => row.action)).not.toContain('tier.old');
      expect(cold.map((row) => row.action).toSorted()).toEqual([
        'tier.ancient',
        'tier.old',
        'tier.older',
      ]);
    });

    it('搬過去的內容與原本一模一樣，id 沿用', async () => {
      const [row] = await db
        .select()
        .from(auditLogsArchive)
        .where(eq(auditLogsArchive.action, 'tier.old'));
      expect(row).toMatchObject({
        actorEmail: 'tier@example.com',
        changes: { before: { name: 'a' }, after: { name: 'b' } },
      });
      expect(typeof row!.id).toBe('bigint');
    });
  });

  describe('I12 不可變', () => {
    it('熱表的列沒有冷表副本時不能刪', async () => {
      const row = await insertLog('tier.guard', daysAgo(2));
      await expectDbError(
        db.delete(auditLogs).where(eq(auditLogs.id, row.id)),
        /AUDIT_LOG_IMMUTABLE/,
      );
    });

    it('冷表副本內容被改過時，熱表的列也不能刪', async () => {
      const row = await insertLog('tier.forged', daysAgo(2));
      await db.insert(auditLogsArchive).values({ ...row, action: 'tier.tampered' });
      await expectDbError(
        db.delete(auditLogs).where(eq(auditLogs.id, row.id)),
        /AUDIT_LOG_IMMUTABLE/,
      );
    });

    it('冷表 UPDATE / DELETE 會被擋下', async () => {
      await expectDbError(
        db
          .update(auditLogsArchive)
          .set({ action: 'x' })
          .where(eq(auditLogsArchive.action, 'tier.old')),
        /AUDIT_LOG_IMMUTABLE/,
      );
      await expectDbError(
        db.delete(auditLogsArchive).where(eq(auditLogsArchive.action, 'tier.old')),
        /AUDIT_LOG_IMMUTABLE/,
      );
    });
  });

  describe('GET /audit-logs', () => {
    it('沒帶時間範圍時只回最近 90 天', async () => {
      const response = await list('action=tier.*').expect(200);
      const actions = (response.body as ListBody).data.items.map((item) => item.action);
      expect(actions).toContain('tier.recent');
      expect(actions).not.toContain('tier.old');
    });

    it('列表不含 changes / metadata', async () => {
      const response = await list('action=tier.recent').expect(200);
      const [item] = (response.body as ListBody).data.items;
      expect(item).toBeDefined();
      expect(item).not.toHaveProperty('changes');
      expect(item).not.toHaveProperty('metadata');
    });

    it('範圍跨進冷表時熱冷一起查，依時間新到舊、總數相加', async () => {
      const from = daysAgo(130).toISOString();
      const to = daysAgo(41).toISOString();
      const response = await list(`action=tier.*&from=${from}&to=${to}`).expect(200);
      const body = response.body as ListBody;
      expect(body.data.items.map((item) => item.action)).toEqual(['tier.old', 'tier.older']);
      expect(body.data.pagination.total).toBe(2);
    });

    it('冷熱合併後分頁仍正確', async () => {
      const from = daysAgo(130).toISOString();
      const to = daysAgo(41).toISOString();
      const response = await list(`action=tier.*&from=${from}&to=${to}&offset=1&limit=1`).expect(
        200,
      );
      expect((response.body as ListBody).data.items.map((item) => item.action)).toEqual([
        'tier.older',
      ]);
    });

    it('範圍超過 90 天回 400', async () => {
      const from = daysAgo(200).toISOString();
      const to = daysAgo(1).toISOString();
      const response = await list(`from=${from}&to=${to}`).expect(400);
      expect((response.body as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
    });

    it('action 前綴裡的 _ 不當萬用字元', async () => {
      await insertLog('tierXrecent', daysAgo(1));
      const response = await list('action=tier_*').expect(200);
      expect((response.body as ListBody).data.items).toHaveLength(0);
    });
  });

  describe('GET /audit-logs/:id', () => {
    it('熱表與冷表的紀錄都查得到，且含 changes', async () => {
      const [hot] = await db
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(eq(auditLogs.action, 'tier.recent'));
      const [cold] = await db
        .select({ id: auditLogsArchive.id })
        .from(auditLogsArchive)
        .where(eq(auditLogsArchive.action, 'tier.ancient'));

      const responses = await Promise.all(
        [hot!.id, cold!.id].map((id) =>
          request(http)
            .get(`/audit-logs/${id.toString()}`)
            .set('authorization', `Bearer ${token}`)
            .expect(200),
        ),
      );
      for (const response of responses) {
        expect((response.body as { data: { changes: unknown } }).data.changes).toEqual({
          before: { name: 'a' },
          after: { name: 'b' },
        });
      }
    });
  });
});
