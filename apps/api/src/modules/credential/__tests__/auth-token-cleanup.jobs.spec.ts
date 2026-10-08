import { describe, expect, it, vi } from 'vitest';

import { AUTH_TOKEN_CLEANUP_JOB, AuthTokenCleanupJobs } from '../auth-token-cleanup.jobs';
import { TOKEN_CLEANUP_BATCH_SIZE } from '../credential.constants';

/** 依序回傳每一批刪除的筆數。 */
function batches(...counts: number[]) {
  return vi.fn(async () => counts.shift() ?? 0);
}

function setup() {
  const jobs = { register: vi.fn() };
  const refreshTokens = { deleteExpiredBatch: batches(TOKEN_CLEANUP_BATCH_SIZE, 7) };
  const authTokens = { deleteStaleBatch: batches(3) };
  const loginSources = { deleteStaleBatch: batches(0) };
  const values: Record<string, unknown> = {
    AUTH_TOKEN_CLEANUP_CRON: '0 3 * * *',
    AUTH_TOKEN_RETENTION_DAYS: 14,
  };
  const config = { get: vi.fn((key: string) => values[key]) };
  const service = new AuthTokenCleanupJobs(
    jobs as never,
    refreshTokens as never,
    authTokens as never,
    loginSources as never,
    config as never,
  );
  return { service, jobs, refreshTokens, authTokens, loginSources };
}

describe('AuthTokenCleanupJobs（docs/architecture/backend/04-auth.md §8）', () => {
  it('工作名稱是 auth.tokenCleanup，同時只跑一個', () => {
    expect(AUTH_TOKEN_CLEANUP_JOB.name).toBe('auth.tokenCleanup');
    expect(AUTH_TOKEN_CLEANUP_JOB.options).toMatchObject({ exclusive: true, retryLimit: 2 });
  });

  it('啟動時以 AUTH_TOKEN_CLEANUP_CRON 註冊排程，handler 執行清理', async () => {
    const { service, jobs } = setup();
    service.onModuleInit();
    expect(jobs.register).toHaveBeenCalledWith(AUTH_TOKEN_CLEANUP_JOB, expect.any(Function), {
      cron: '0 3 * * *',
    });
    const handler = jobs.register.mock.calls[0]![1] as () => Promise<unknown>;
    await expect(handler()).resolves.toEqual({
      refreshTokens: TOKEN_CLEANUP_BATCH_SIZE + 7,
      authTokens: 3,
      loginSources: 0,
    });
  });

  it('分批刪除 refresh token、啟用／重設 token 與過期的登入來源，回傳各自的總數', async () => {
    const { service, refreshTokens, authTokens, loginSources } = setup();
    await expect(service.run()).resolves.toEqual({
      refreshTokens: TOKEN_CLEANUP_BATCH_SIZE + 7,
      authTokens: 3,
      loginSources: 0,
    });
    // 一批刪滿就再刪一批，不滿就停
    expect(refreshTokens.deleteExpiredBatch).toHaveBeenCalledTimes(2);
    expect(refreshTokens.deleteExpiredBatch).toHaveBeenCalledWith(14, TOKEN_CLEANUP_BATCH_SIZE);
    expect(authTokens.deleteStaleBatch).toHaveBeenCalledWith(14, TOKEN_CLEANUP_BATCH_SIZE);
    expect(loginSources.deleteStaleBatch).toHaveBeenCalledWith(TOKEN_CLEANUP_BATCH_SIZE);
  });
});
