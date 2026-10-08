import { describe, expect, it } from 'vitest';

import { userLoginSources } from '@/db/schema';

import { LOGIN_SOURCE_RETENTION_DAYS, LoginSourceService } from '../login-source.service';
import { fakeDb, render } from './fake-db';

function setup(results: unknown[] = []) {
  const { db, queries } = fakeDb(results);
  return { service: new LoginSourceService(db as never), queries };
}

describe('LoginSourceService（docs/architecture/backend/04-auth.md §3.4）', () => {
  it('保留天數是 30 天', () => {
    expect(LOGIN_SOURCE_RETENTION_DAYS).toBe(30);
  });

  it('isKnown：30 天內在這個 IP 前綴成功登入過 → true', async () => {
    const { service, queries } = setup([[{ userId: 'u1' }]]);
    await expect(service.isKnown('u1', '203.0.113')).resolves.toBe(true);
    const where = render(queries[0]!.arg('where'));
    expect(where.sql).toContain('"user_login_sources"."user_id" = $1');
    expect(where.sql).toContain('"user_login_sources"."ip_prefix" = $2');
    expect(where.sql).toContain('make_interval(days => $3::int)');
    expect(where.params).toEqual(['u1', '203.0.113', 30]);
    expect(queries[0]!.arg('limit')).toBe(1);
  });

  it('isKnown：查不到 → false', async () => {
    const { service } = setup([[]]);
    await expect(service.isKnown('u1', '203.0.113')).resolves.toBe(false);
  });

  it('remember：新增來源，已存在時只更新最後成功時間', async () => {
    const { service, queries } = setup();
    await service.remember('u1', '203.0.113');
    expect(queries[0]!.arg('insert')).toBe(userLoginSources);
    expect(queries[0]!.arg('values')).toEqual({ userId: 'u1', ipPrefix: '203.0.113' });
    const conflict = queries[0]!.arg('onConflictDoUpdate') as {
      target: unknown[];
      set: { lastSuccessAt: unknown };
    };
    expect(conflict.target).toEqual([userLoginSources.userId, userLoginSources.ipPrefix]);
    expect(render(conflict.set.lastSuccessAt).sql).toBe('now()');
  });

  it('deleteStaleBatch：篩出超過保留天數的最多 batchSize 筆刪除，回傳刪除的筆數', async () => {
    const { service, queries } = setup([[{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }]]);
    await expect(service.deleteStaleBatch(100)).resolves.toBe(3);
    const [stale, del] = queries;
    expect(stale!.kind).toBe('select');
    expect(stale!.arg('limit')).toBe(100);
    const staleWhere = render(stale!.arg('where'));
    expect(staleWhere.sql).toContain('"user_login_sources"."last_success_at" <');
    expect(staleWhere.params).toEqual([30]);
    expect(del!.arg('delete')).toBe(userLoginSources);
  });
});
