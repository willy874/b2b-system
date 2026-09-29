import { Injectable, Module } from '@nestjs/common';
import type { INestApplication, OnModuleInit } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';

import { DRIZZLE, withTransaction } from '@/core/database';
import type { Database } from '@/core/database';
import { defineJob, JobQueue, JobStore } from '@/core/jobs';
import { auditLogs, roles, userRoles, users } from '@/db/schema';

import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';

/** 第一次執行失敗、之後成功：用來走一遍「失敗 → 手動重試 → 完成」。 */
const FLAKY_JOB = defineJob<{ label: string }>('test.flaky', {
  retryLimit: 0,
  retryDelaySeconds: 1,
});

@Injectable()
class FlakyJob implements OnModuleInit {
  private readonly attempts = new Map<string, number>();

  constructor(private readonly jobs: JobQueue) {}

  onModuleInit(): void {
    this.jobs.register(FLAKY_JOB, async ({ label }) => {
      const attempt = (this.attempts.get(label) ?? 0) + 1;
      this.attempts.set(label, attempt);
      if (attempt === 1) throw new Error(`${label} 第一次執行失敗`);
      return { attempt };
    });
  }
}

@Module({ providers: [FlakyJob] })
class FlakyJobModule {}

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;
let jobs: JobQueue;
let store: JobStore;

const SUPER_ADMIN = { email: 'jobs-root@example.com', password: 'RootPassword!2026' };
const AUDITOR = { email: 'jobs-auditor@example.com', password: 'AuditorPassword!2026' };

async function login(credentials: { email: string; password: string }): Promise<string> {
  const response = await request(http).post('/auth/login').send(credentials).expect(200);
  return (response.body as { data: { accessToken: string } }).data.accessToken;
}

/** worker 以輪詢取工作；等到工作進入指定狀態為止。 */
async function waitForState(id: string, state: string) {
  return vi.waitFor(
    async () => {
      const job = await store.find(jobs.names(), id);
      expect(job?.state).toBe(state);
      return job!;
    },
    { timeout: 20_000, interval: 200 },
  );
}

describe('背景工作（docs/architecture/backend/10-jobs.md）', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = inject('databaseUrl');
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN.email;
    process.env.SUPER_ADMIN_PASSWORD = SUPER_ADMIN.password;
    process.env.JOBS_WORKER_ENABLED = 'true';
    // 排程不在測試期間觸發：一年一次
    process.env.AUDIT_LOG_ARCHIVE_CRON = '0 0 1 1 *';
    process.env.FILE_MAINTENANCE_CRON = '';

    const created = createTestDatabase();
    db = created.db;
    closeDb = async () => created.client.end();
    await truncateAll(db);
    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);

    const { hashPassword } = await import('@/modules/auth/password');
    const [auditor] = await db
      .insert(users)
      .values({
        email: AUDITOR.email,
        displayName: AUDITOR.email,
        passwordHash: await hashPassword(AUDITOR.password),
        status: 'active',
      })
      .returning();
    const [auditorRole] = await db.select().from(roles).where(eq(roles.slug, 'auditor'));
    await db.insert(userRoles).values({ userId: auditor!.id, roleId: auditorRole!.id });

    const { AppModule } = await import('@/app.module');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, FlakyJobModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    http = app.getHttpServer() as App;
    jobs = app.get(JobQueue);
    store = app.get(JobStore);
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
    delete process.env.JOBS_WORKER_ENABLED;
    delete process.env.AUDIT_LOG_ARCHIVE_CRON;
    delete process.env.FILE_MAINTENANCE_CRON;
  });

  describe('入列在業務交易內（docs/adr/0016-background-jobs.md D2）', () => {
    it('交易回滾時工作也不存在', async () => {
      const appDb = app.get<Database>(DRIZZLE);
      let id: string | null = null;
      await expect(
        withTransaction(appDb, async (tx) => {
          id = await jobs.enqueue(FLAKY_JOB, { label: 'rollback' }, { tx });
          throw new Error('業務失敗');
        }),
      ).rejects.toThrow('業務失敗');
      expect(id).not.toBeNull();
      expect(await store.find(jobs.names(), id!)).toBeUndefined();
    });

    it('交易提交後工作才出現並被執行', async () => {
      const appDb = app.get<Database>(DRIZZLE);
      const id = await withTransaction(appDb, (tx) =>
        jobs.enqueue(FLAKY_JOB, { label: 'commit' }, { tx }),
      );
      // 第一次執行失敗、retryLimit 0 → 直接停在 failed
      const job = await waitForState(id!, 'failed');
      expect(job.output).toMatchObject({ message: 'commit 第一次執行失敗' });
    });
  });

  it('沒註冊的工作不能入列', async () => {
    await expect(jobs.enqueue(defineJob('test.unknown'), {})).rejects.toThrow('沒有註冊');
  });

  describe('管理 API', () => {
    let failedId: string;

    beforeAll(async () => {
      failedId = (await jobs.enqueue(FLAKY_JOB, { label: 'manual' }))!;
      await waitForState(failedId, 'failed');
    });

    it('GET /jobs/queues 列出已註冊的工作與排程', async () => {
      const token = await login(SUPER_ADMIN);
      const response = await request(http)
        .get('/jobs/queues')
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      const items = (response.body as { data: { items: Array<Record<string, unknown>> } }).data
        .items;
      const byName = new Map(items.map((queue) => [queue.name, queue]));
      expect([...byName.keys()]).toEqual(
        expect.arrayContaining(['auditLog.archive', 'file.maintenance', 'test.flaky']),
      );
      expect(byName.get('auditLog.archive')).toMatchObject({ cron: '0 0 1 1 *' });
      expect(byName.get('file.maintenance')).toMatchObject({ cron: null });
      // 即時計數：前面兩個 failed（commit、manual）
      expect(byName.get('test.flaky')).toMatchObject({ failedCount: 2, activeCount: 0 });
    });

    it('GET /jobs 依佇列與狀態篩選，不含 data / output', async () => {
      const token = await login(SUPER_ADMIN);
      const response = await request(http)
        .get('/jobs?name=test.flaky&state=failed')
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      const body = response.body as {
        data: { items: Array<Record<string, unknown>>; pagination: { total: number } };
      };
      expect(body.data.items.map((job) => job.id)).toContain(failedId);
      expect(body.data.items.every((job) => job.state === 'failed')).toBe(true);
      expect(body.data.items[0]).not.toHaveProperty('output');
    });

    it('GET /jobs/:id 含 data 與失敗原因；查不到回 404', async () => {
      const token = await login(SUPER_ADMIN);
      const response = await request(http)
        .get(`/jobs/${failedId}`)
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      expect((response.body as { data: unknown }).data).toMatchObject({
        name: 'test.flaky',
        state: 'failed',
        data: { label: 'manual' },
        output: { message: 'manual 第一次執行失敗' },
      });

      const missing = await request(http)
        .get('/jobs/00000000-0000-4000-8000-000000000000')
        .set('authorization', `Bearer ${token}`)
        .expect(404);
      expect((missing.body as { error: { code: string } }).error.code).toBe('JOB_NOT_FOUND');
    });

    it('auditor 看得到但不能重試', async () => {
      const token = await login(AUDITOR);
      await request(http).get('/jobs').set('authorization', `Bearer ${token}`).expect(200);
      await request(http)
        .post(`/jobs/${failedId}/retry`)
        .set('authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('POST /jobs/:id/retry 重新排入並寫稽核；worker 再執行後完成', async () => {
      const token = await login(SUPER_ADMIN);
      const response = await request(http)
        .post(`/jobs/${failedId}/retry`)
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      expect((response.body as { data: { state: string } }).data.state).not.toBe('failed');

      const [audit] = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'job.retry'), eq(auditLogs.resourceId, failedId)));
      expect(audit).toMatchObject({
        resourceType: 'job',
        resourceName: 'test.flaky',
        actorEmail: SUPER_ADMIN.email,
      });

      const job = await waitForState(failedId, 'completed');
      expect(job.output).toEqual({ attempt: 2 });
    });

    it('不是 failed 的工作不能重試（409）', async () => {
      const token = await login(SUPER_ADMIN);
      const response = await request(http)
        .post(`/jobs/${failedId}/retry`)
        .set('authorization', `Bearer ${token}`)
        .expect(409);
      expect((response.body as { error: { code: string } }).error.code).toBe('JOB_NOT_RETRYABLE');
    });
  });

  it('auditLog.archive 由 worker 執行，搬移筆數存在 output', async () => {
    const { AUDIT_LOG_ARCHIVE_JOB } = await import('@/modules/audit-log/audit-log-archive.job');
    await db.insert(auditLogs).values({
      occurredAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
      actorEmail: 'old@example.com',
      action: 'jobs.old',
      resourceType: 'jobs',
      result: 'success',
    });
    const id = await jobs.enqueue(AUDIT_LOG_ARCHIVE_JOB, {});
    const job = await waitForState(id!, 'completed');
    expect(job.output).toMatchObject({ moved: 1 });
  });
});
