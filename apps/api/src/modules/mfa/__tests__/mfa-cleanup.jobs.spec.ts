import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MFA_CLEANUP_JOB, MFA_PLATFORM_CLEANUP_JOB, MfaCleanupJobs } from '../mfa-cleanup.jobs';
import {
  MFA_CHALLENGE_RETENTION_MS,
  MFA_CLEANUP_BATCH_SIZE,
  MFA_PENDING_FACTOR_TTL_MS,
} from '../mfa.constants';

const NOW = new Date('2026-10-08T03:00:00.000Z');

function setup() {
  const jobs = { register: vi.fn() };
  const tenantRepo = {
    deleteStaleBatch: vi
      .fn()
      .mockResolvedValueOnce(MFA_CLEANUP_BATCH_SIZE)
      .mockResolvedValueOnce(3),
  };
  const platformRepo = { deleteStaleBatch: vi.fn().mockResolvedValue(0) };
  const config = { get: vi.fn(() => '0 4 * * *') };
  const cleanup = new MfaCleanupJobs(
    jobs as never,
    tenantRepo as never,
    platformRepo as never,
    config as never,
  );
  return { cleanup, jobs, tenantRepo, platformRepo };
}

describe('MfaCleanupJobs（docs/architecture/backend/21-mfa.md §3）', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('以 AUTH_TOKEN_CLEANUP_CRON 登記租戶與平台兩份清理，各自清自己的儲存', async () => {
    const { cleanup, jobs, tenantRepo, platformRepo } = setup();
    cleanup.onModuleInit();
    expect(jobs.register).toHaveBeenCalledWith(MFA_CLEANUP_JOB, expect.any(Function), {
      cron: '0 4 * * *',
    });
    expect(jobs.register).toHaveBeenCalledWith(MFA_PLATFORM_CLEANUP_JOB, expect.any(Function), {
      cron: '0 4 * * *',
    });
    const handlers = new Map(
      jobs.register.mock.calls.map(([type, handler]) => [type, handler as () => Promise<unknown>]),
    );
    expect(await handlers.get(MFA_CLEANUP_JOB)!()).toEqual({
      deleted: MFA_CLEANUP_BATCH_SIZE + 3,
    });
    expect(await handlers.get(MFA_PLATFORM_CLEANUP_JOB)!()).toEqual({ deleted: 0 });
    expect(tenantRepo.deleteStaleBatch).toHaveBeenCalledTimes(2);
    expect(platformRepo.deleteStaleBatch).toHaveBeenCalledTimes(1);
  });

  it('pending 的因子保留 24 小時、過期的 challenge 再保留 24 小時，分批刪到不足一批為止', async () => {
    const { cleanup, tenantRepo } = setup();
    await cleanup.run(tenantRepo as never);
    expect(tenantRepo.deleteStaleBatch).toHaveBeenCalledWith(
      new Date(NOW.getTime() - MFA_PENDING_FACTOR_TTL_MS),
      new Date(NOW.getTime() - MFA_CHALLENGE_RETENTION_MS),
      MFA_CLEANUP_BATCH_SIZE,
    );
  });
});
