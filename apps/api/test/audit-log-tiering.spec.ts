import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { auditLogs, auditLogsArchive } from '@/db/schema';
import { maintainAuditArchive } from '@/modules/audit-log/audit-log.archive';
import { AUDIT_LOG_COUNT_CAP, AUDIT_LOG_MAX_OFFSET } from '@/modules/audit-log/audit-log.constants';

import type { TestDatabase } from './db';
import { createTestDatabase, expectDbError, truncateAll } from './db';
import { listenOnLoopback } from './http';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;
let token: string;

const SUPER_ADMIN = { email: 'root@example.com', password: 'Quiet-Harbor-Lantern-26' };
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);

interface ListBody {
  data: {
    items: Array<Record<string, unknown> & { id: string; action: string }>;
    pagination: { total: number };
    nextCursor: string | null;
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
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN.email;
    process.env.SUPER_ADMIN_PASSWORD = SUPER_ADMIN.password;
    // 游標分頁的測試要逐頁走完上萬筆（一百多個請求）
    process.env.DEFAULT_RATE_LIMIT = '10000';

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
    delete process.env.DEFAULT_RATE_LIMIT;
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

    it('冷表裡有範圍內的紀錄就一起查（保留天數調大後，已搬走的紀錄不會回到熱表；docs/architecture/05-tenancy.md §13.3 D7）', async () => {
      // 模擬保留天數曾經很短：10 天前的紀錄已經在冷表
      await insertLog('tier.shortRetention', daysAgo(10));
      await archive(daysAgo(9));
      const [cold] = await db
        .select()
        .from(auditLogsArchive)
        .where(eq(auditLogsArchive.action, 'tier.shortRetention'));
      expect(cold).toBeDefined();
      const response = await list('action=tier.shortRetention').expect(200);
      expect((response.body as ListBody).data.items.map((item) => item.action)).toEqual([
        'tier.shortRetention',
      ]);
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

    it('游標分頁跨冷熱：逐頁取到最後一頁，nextCursor 是 null', async () => {
      const from = daysAgo(130).toISOString();
      const to = daysAgo(41).toISOString();
      const first = (await list(`action=tier.*&from=${from}&to=${to}&limit=1`).expect(200))
        .body as ListBody;
      expect(first.data.items.map((item) => item.action)).toEqual(['tier.old']);
      expect(first.data.nextCursor).toEqual(expect.any(String));

      const second = (
        await list(
          `action=tier.*&from=${from}&to=${to}&limit=1&cursor=${first.data.nextCursor}`,
        ).expect(200)
      ).body as ListBody;
      expect(second.data.items.map((item) => item.action)).toEqual(['tier.older']);
      expect(second.data.nextCursor).toBeNull();
      // 總數不受游標影響
      expect(second.data.pagination.total).toBe(2);
    });

    it('同一個時間點的多筆以 id 接續，不重複也不漏', async () => {
      const at = daysAgo(2);
      const ids = [];
      for (let i = 0; i < 3; i += 1) {
        // oxlint-disable-next-line no-await-in-loop -- 依序寫入，id 遞增
        ids.push((await insertLog('tier.sameTime', at)).id.toString());
      }
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const query: string = `action=tier.sameTime&limit=1${cursor ? `&cursor=${cursor}` : ''}`;
        // oxlint-disable-next-line no-await-in-loop -- 逐頁往下
        const body = (await list(query).expect(200)).body as ListBody;
        seen.push(...body.data.items.map((item) => item.id));
        cursor = body.data.nextCursor;
      } while (cursor);
      expect(seen).toEqual(ids.toReversed());
    });

    it('游標與 offset 不能同時帶；格式不對的游標回 400', async () => {
      const both = await list('offset=1&cursor=abc').expect(400);
      expect((both.body as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
      const invalid = await list('cursor=not-a-cursor').expect(400);
      expect((invalid.body as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
    });

    it('offset 超過上限回 400（深分頁要掃過 offset 筆）', async () => {
      const response = await list(`offset=${AUDIT_LOG_MAX_OFFSET + 1}`).expect(400);
      expect((response.body as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
    });

    it('total 最多數到 AUDIT_LOG_COUNT_CAP（不為了總數掃過整個 90 天）', async () => {
      await db.execute(sql`
        INSERT INTO audit_logs (actor_email, action, resource_type, result)
        SELECT 'cap@example.com', 'cap.row', 'cap', 'success'
        FROM generate_series(1, ${AUDIT_LOG_COUNT_CAP + 50})`);
      const response = await list('action=cap.*&limit=1').expect(200);
      expect((response.body as ListBody).data.pagination.total).toBe(AUDIT_LOG_COUNT_CAP);
    });

    it('游標分頁翻得過 offset 的上限：逐頁走完全部紀錄', async () => {
      let count = 0;
      let cursor: string | null = null;
      do {
        const query: string = `action=cap.*&limit=100${cursor ? `&cursor=${cursor}` : ''}`;
        // oxlint-disable-next-line no-await-in-loop -- 逐頁往下
        const body = (await list(query).expect(200)).body as ListBody;
        count += body.data.items.length;
        cursor = body.data.nextCursor;
      } while (cursor);
      expect(count).toBe(AUDIT_LOG_COUNT_CAP + 50);
      expect(count).toBeGreaterThan(AUDIT_LOG_MAX_OFFSET);
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

  it('冷表也有 action 前綴查詢的索引（text_pattern_ops）', async () => {
    const rows = await db.execute<{ indexdef: string }>(
      sql`SELECT indexdef FROM pg_indexes WHERE indexname = 'audit_logs_archive_action_idx'`,
    );
    expect(rows[0]?.indexdef).toContain('action text_pattern_ops');
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

    it('查無 → 404 AUDIT_LOG_NOT_FOUND；不是正整數 → 400 VALIDATION_FAILED', async () => {
      const missing = await request(http)
        .get('/audit-logs/999999999999')
        .set('authorization', `Bearer ${token}`)
        .expect(404);
      expect((missing.body as { error: { code: string } }).error.code).toBe('AUDIT_LOG_NOT_FOUND');
      const malformed = await request(http)
        .get('/audit-logs/abc')
        .set('authorization', `Bearer ${token}`)
        .expect(400);
      expect((malformed.body as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
    });
  });

  // 放在最後：會多搬一筆到冷表，放前面會影響上面的總數
  describe('SECURITY DEFINER（docs/architecture/backend/10-jobs.md §9.2 D8）', () => {
    /** 模擬「只有 SELECT / INSERT」的應用程式 role；在交易內 SET LOCAL ROLE，結束後自動還原。 */
    async function asLimitedRole<T>(fn: (tx: TestDatabase) => Promise<T>): Promise<T> {
      await db.execute(sql`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'audit_limited') THEN
            CREATE ROLE audit_limited NOLOGIN;
          END IF;
        END $$`);
      await db.execute(sql`GRANT USAGE ON SCHEMA public TO audit_limited`);
      await db.execute(
        sql`GRANT SELECT, INSERT ON audit_logs, audit_logs_archive TO audit_limited`,
      );
      return db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE audit_limited`);
        return fn(tx as unknown as TestDatabase);
      });
    }

    it('沒有 audit_logs DELETE 權限的 role 不能直接刪', async () => {
      await expectDbError(
        asLimitedRole((tx) => tx.execute(sql`DELETE FROM audit_logs WHERE action = 'tier.recent'`)),
        /permission denied/,
      );
    });

    it('同一個 role 可以透過 archive_audit_logs() 搬移', async () => {
      await insertLog('tier.limited', daysAgo(200));
      const [row] = await asLimitedRole((tx) =>
        tx.execute<{ moved: number }>(
          sql`SELECT archive_audit_logs(${daysAgo(90).toISOString()}::timestamptz, 100) AS moved`,
        ),
      );
      expect(Number(row?.moved)).toBe(1);
      const cold = await db
        .select({ id: auditLogsArchive.id })
        .from(auditLogsArchive)
        .where(eq(auditLogsArchive.action, 'tier.limited'));
      expect(cold).toHaveLength(1);
    });

    it('不是擁有者的 role 不能自己 DROP 或 DETACH 冷表的分區（只能透過 drop_expired_audit_archive_partitions）', async () => {
      const [partition] = await db.execute<{ name: string }>(sql`
        SELECT c.relname AS name FROM pg_inherits i
        JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent
        WHERE p.relname = 'audit_logs_archive' LIMIT 1`);
      await expectDbError(
        asLimitedRole((tx) => tx.execute(sql.raw(`DROP TABLE ${partition!.name}`))),
        /must be owner|permission denied/,
      );
      await expectDbError(
        asLimitedRole((tx) =>
          tx.execute(sql.raw(`ALTER TABLE audit_logs_archive DETACH PARTITION ${partition!.name}`)),
        ),
        /must be owner|permission denied/,
      );
    });
  });

  // 放在最後：會刪掉冷表裡一年以前的月份（其他測試用到 tier.ancient）
  describe('冷表的月份分區與保留期限（docs/architecture/backend/06-audit-log.md §10）', () => {
    const partitionOf = async (id: bigint) => {
      const [row] = await db.execute<{ partition: string }>(
        sql`SELECT tableoid::regclass::text AS partition FROM audit_logs_archive WHERE id = ${id.toString()}::bigint`,
      );
      return row?.partition;
    };

    it('搬到冷表時自動建出那個月份的分區', async () => {
      const old = await insertLog('tier.partitioned', new Date('2023-02-10T00:00:00Z'));
      await archive(daysAgo(200));
      expect(await partitionOf(old.id)).toBe('audit_logs_archive_p202302');
    });

    it('保留天數是 -1（永久）→ 不刪任何分區', async () => {
      const purged = await maintainAuditArchive(db as never, {
        retentionDays: -1,
        hotRetentionDays: 90,
        foreverValue: -1,
      });
      expect(purged).toEqual([]);
    });

    it('資料庫函式拒絕一年內的 cutoff（應用程式即使被濫用也刪不到）', async () => {
      await expectDbError(
        db.execute(sql`SELECT * FROM drop_expired_audit_archive_partitions(current_date - 30)`),
        /AUDIT_LOG_IMMUTABLE/,
      );
    });

    it('依保留天數 DROP 整個月份分區，並寫 auditLog.purge；一年內的分區保留', async () => {
      const purged = await maintainAuditArchive(db as never, {
        retentionDays: 365,
        hotRetentionDays: 90,
        foreverValue: -1,
      });
      expect(purged.map((item) => item.partition)).toContain('audit_logs_archive_p202302');
      const remaining = await db
        .select({ action: auditLogsArchive.action })
        .from(auditLogsArchive)
        .where(eq(auditLogsArchive.action, 'tier.partitioned'));
      expect(remaining).toEqual([]);
      const logs = await db
        .select({ metadata: auditLogs.metadata })
        .from(auditLogs)
        .where(eq(auditLogs.action, 'auditLog.purge'));
      expect(logs.length).toBe(purged.length);
      // 一年內的冷資料（10 天前的 tier.shortRetention）不受影響
      expect(
        await db
          .select()
          .from(auditLogsArchive)
          .where(eq(auditLogsArchive.action, 'tier.shortRetention')),
      ).toHaveLength(1);
    });
  });
});
