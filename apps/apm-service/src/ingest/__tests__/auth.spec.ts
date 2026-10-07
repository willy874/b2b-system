import type { ApmProject } from '@/config';
import { ApmError } from '@/http/errors';

import { authenticateApi, authenticateIngest } from '../auth';

const KEY = 'a'.repeat(32);
const projects: ApmProject[] = [{ id: '1', slug: 'backstage', publicKey: KEY }];

function ingest(projectId: string, credentials: Partial<Parameters<typeof authenticateIngest>[2]>) {
  return authenticateIngest(projects, projectId, {
    query: new URLSearchParams(),
    authHeader: undefined,
    envelopeDsn: undefined,
    ...credentials,
  });
}

function statusOf(run: () => unknown): number | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return error instanceof ApmError ? error.status : -1;
  }
}

describe('authenticateIngest（收件端點的 DSN 驗證）', () => {
  it('接受 query 的 sentry_key（瀏覽器 SDK 的做法）', () => {
    expect(ingest('1', { query: new URLSearchParams({ sentry_key: KEY }) }).slug).toBe('backstage');
  });

  it('接受 X-Sentry-Auth header', () => {
    expect(ingest('1', { authHeader: `Sentry sentry_version=7, sentry_key=${KEY}` }).slug).toBe(
      'backstage',
    );
  });

  it('接受 envelope header 的 dsn（SDK 的 tunnel）', () => {
    expect(ingest('1', { envelopeDsn: `https://${KEY}@acme.example.com/apm/1` }).slug).toBe(
      'backstage',
    );
  });

  it('專案不存在 → 404', () => {
    expect(statusOf(() => ingest('2', { query: new URLSearchParams({ sentry_key: KEY }) }))).toBe(
      404,
    );
  });

  it('沒有 key → 401', () => {
    expect(statusOf(() => ingest('1', {}))).toBe(401);
  });

  it('key 屬於別的專案或錯誤 → 401', () => {
    expect(
      statusOf(() => ingest('1', { query: new URLSearchParams({ sentry_key: 'b'.repeat(32) }) })),
    ).toBe(401);
  });
});

describe('authenticateApi（查詢與上傳 API）', () => {
  it('Bearer token 相符才放行', () => {
    expect(() =>
      authenticateApi('Bearer secret-token-123456', 'secret-token-123456'),
    ).not.toThrow();
    expect(statusOf(() => authenticateApi('Bearer wrong', 'secret-token-123456'))).toBe(401);
    expect(statusOf(() => authenticateApi(undefined, 'secret-token-123456'))).toBe(401);
  });
});
