import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '@/core/config';
import type { Database } from '@/core/database';
import type { JobQueue } from '@/core/jobs';
import { runInTenantContext } from '@/core/tenant';
import type { TenantContext, TenantFeatureParamOverrides } from '@/core/tenant';

import { AUDIT_LOG_ARCHIVE_JOB, AuditLogArchiveJob } from '../audit-log-archive.job';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-06T03:30:00.000Z');

function inTenant<T>(featureParams: TenantFeatureParamOverrides, fn: () => Promise<T>) {
  return runInTenantContext({ id: 't1', featureParams } as unknown as TenantContext, fn);
}

function build(cron = '30 3 * * *') {
  const execute = vi.fn(async () => [{ moved: 4 }]);
  const register = vi.fn();
  const job = new AuditLogArchiveJob(
    { execute } as unknown as Database,
    { register } as unknown as JobQueue,
    { get: vi.fn(() => cron) } as unknown as ConfigService<Env, true>,
  );
  return { job, execute, register };
}

describe('AuditLogArchiveJob（docs/architecture/backend/06-audit-log.md §8、10-jobs.md §3）', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('auditLog.archive 是 exclusive 的租戶工作，重試 3 次、最多執行 1 小時', () => {
    expect(AUDIT_LOG_ARCHIVE_JOB.name).toBe('auditLog.archive');
    expect(AUDIT_LOG_ARCHIVE_JOB.options).toMatchObject({
      scope: 'tenant',
      exclusive: true,
      retryLimit: 3,
      retryDelaySeconds: 300,
      expireInSeconds: 3600,
    });
  });

  it('以 AUDIT_LOG_ARCHIVE_CRON 註冊成排程工作', () => {
    const { job, register } = build('0 2 * * *');
    job.onModuleInit();
    expect(register).toHaveBeenCalledWith(AUDIT_LOG_ARCHIVE_JOB, expect.any(Function), {
      cron: '0 2 * * *',
    });
  });

  it('註冊的 handler 就是 run（排程觸發時實際搬移）', async () => {
    const { job, register, execute } = build();
    job.onModuleInit();
    const registered = register.mock.calls[0]?.[1] as () => Promise<unknown>;
    await inTenant({}, () => registered());
    expect(execute).toHaveBeenCalled();
  });

  it('沒有覆寫 → 熱表保留 90 天，回傳搬移筆數與 ISO 截止時間', async () => {
    const { job } = build();
    await expect(inTenant({}, () => job.run())).resolves.toEqual({
      moved: 4,
      cutoff: new Date(NOW.getTime() - 90 * DAY).toISOString(),
      retentionDays: 90,
    });
  });

  it('租戶的 auditLog.hotRetentionDays 覆寫 → 依它計算截止時間', async () => {
    const { job } = build();
    const result = await inTenant({ 'auditLog.hotRetentionDays': 30 }, () => job.run());
    expect(result).toMatchObject({
      retentionDays: 30,
      cutoff: new Date(NOW.getTime() - 30 * DAY).toISOString(),
    });
  });

  it('覆寫值不合法（低於下限 7 天）→ 退回預設 90 天', async () => {
    const { job } = build();
    const result = await inTenant({ 'auditLog.hotRetentionDays': 1 }, () => job.run());
    expect(result.retentionDays).toBe(90);
  });

  it('沒有租戶脈絡 → TENANT_NOT_FOUND，不搬移（不能悄悄用預設值）', async () => {
    const { job, execute } = build();
    await expect(job.run()).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
    expect(execute).not.toHaveBeenCalled();
  });
});
