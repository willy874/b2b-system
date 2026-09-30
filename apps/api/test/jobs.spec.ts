import { Injectable, Module } from '@nestjs/common';
import type { INestApplication, OnModuleInit } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { TENANT_DB, withTransaction } from '@/core/database';
import type { Database } from '@/core/database';
import { defineJob, JobQueue, JobStore } from '@/core/jobs';
import { auditLogs, jobOutbox, roles, userRoles, users } from '@/db/schema';

import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';
import { inTestTenant, testTenantContext } from './tenant';

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
let tenantId: string;

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
      const job = await store.find(tenantId, jobs.names(), id);
      expect(job?.state).toBe(state);
      return job!;
    },
    { timeout: 20_000, interval: 200 },
  );
}

describe('背景工作（docs/architecture/backend/10-jobs.md）', () => {
  beforeAll(async () => {
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

    const { hashPassword } = await import('@/modules/credential/password');
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
    http = await listenOnLoopback(app);
    jobs = app.get(JobQueue);
    store = app.get(JobStore);
    tenantId = (await testTenantContext(app)).id;
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
    delete process.env.JOBS_WORKER_ENABLED;
    delete process.env.AUDIT_LOG_ARCHIVE_CRON;
    delete process.env.FILE_MAINTENANCE_CRON;
  });

  describe('入列在業務交易內（docs/adr/0016-background-jobs.md D2）', () => {
    it('交易回滾時工作也不存在（outbox 跟著回滾）', async () => {
      const appDb = app.get<Database>(TENANT_DB);
      let id: string | null = null;
      await expect(
        inTestTenant(app, () =>
          withTransaction(appDb, async (tx) => {
            id = await jobs.enqueue(FLAKY_JOB, { label: 'rollback' }, { tx });
            throw new Error('業務失敗');
          }),
        ),
      ).rejects.toThrow('業務失敗');
      expect(id).not.toBeNull();
      expect(await store.find(tenantId, jobs.names(), id!)).toBeUndefined();
      expect(await db.select().from(jobOutbox)).toHaveLength(0);
    });

    it('交易提交後才從 outbox 搬進佇列並被執行，工作 id 就是 outbox 的 id（docs/adr/0020 D15）', async () => {
      const appDb = app.get<Database>(TENANT_DB);
      const id = await inTestTenant(app, () =>
        withTransaction(appDb, (tx) => jobs.enqueue(FLAKY_JOB, { label: 'commit' }, { tx })),
      );
      expect(await db.select().from(jobOutbox)).toHaveLength(0);
      // 第一次執行失敗、retryLimit 0 → 直接停在 failed
      const job = await waitForState(id!, 'failed');
      expect(job.output).toMatchObject({ message: 'commit 第一次執行失敗' });
    });
  });

  it('沒註冊的工作不能入列', async () => {
    await expect(jobs.enqueue(defineJob('test.unknown'), {})).rejects.toThrow('沒有註冊');
  });

  it('租戶的工作沒有租戶脈絡時不能入列', async () => {
    await expect(jobs.enqueue(FLAKY_JOB, { label: 'no-tenant' })).rejects.toThrow(
      'TENANT_NOT_FOUND',
    );
  });

  it('提交後的搬移沒成功（程序當掉）時，定期清掃會補搬', async () => {
    const [row] = await db
      .insert(jobOutbox)
      .values({ name: FLAKY_JOB.name, data: { label: 'swept' } })
      .returning();
    expect(await inTestTenant(app, () => jobs.relayOutbox())).toBe(1);
    const job = await waitForState(row!.id, 'failed');
    expect(job.data).toEqual({ label: 'swept' });
    // 再搬一次也不會多出工作
    expect(await inTestTenant(app, () => jobs.relayOutbox())).toBe(0);
  });

  describe('管理 API', () => {
    let failedId: string;

    beforeAll(async () => {
      failedId = (await inTestTenant(app, () => jobs.enqueue(FLAKY_JOB, { label: 'manual' })))!;
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
      // 即時計數：前面三個 failed（commit、swept、manual）
      expect(byName.get('test.flaky')).toMatchObject({ failedCount: 3, activeCount: 0 });
      // 平台工作不在租戶的管理頁
      expect(byName.has('oidc.cleanup')).toBe(false);
      expect(byName.has('jobs.outboxSweep')).toBe(false);
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
    const id = await inTestTenant(app, () => jobs.enqueue(AUDIT_LOG_ARCHIVE_JOB, {}));
    const job = await waitForState(id!, 'completed');
    expect(job.output).toMatchObject({ moved: 1 });
  });

  it('排程觸發的租戶工作（沒有 tenantId）展開成每個 active 租戶一筆', async () => {
    const { AUDIT_LOG_ARCHIVE_JOB } = await import('@/modules/audit-log/audit-log-archive.job');
    // 模擬 pg-boss 的排程：資料是 null、不屬於任何租戶
    const boss = (jobs as unknown as { boss: { send: (...args: unknown[]) => Promise<string> } })
      .boss;
    await boss.send(AUDIT_LOG_ARCHIVE_JOB.name, null, { singletonKey: 'scheduled-test' });
    // 前一個測試已完成一筆；展開後測試租戶再多一筆完成的
    const spawned = await vi.waitFor(
      async () => {
        const { items } = await store.list({
          tenantId,
          names: [AUDIT_LOG_ARCHIVE_JOB.name],
          state: 'completed',
          offset: 0,
          limit: 10,
        });
        expect(items.length).toBeGreaterThanOrEqual(2);
        return items;
      },
      { timeout: 20_000, interval: 200 },
    );
    expect(spawned[0]?.name).toBe(AUDIT_LOG_ARCHIVE_JOB.name);
  });
});
