import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authTokens } from '@/db/schema';

import { issueAuthToken } from '../auth-token-issue';
import { sha256 } from '../token-hash';
import { fakeDb, render } from './fake-db';

const NOW = new Date('2026-10-08T00:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('issueAuthToken（docs/architecture/backend/11-mail.md §9.2 D7）', () => {
  it('先作廢同一位使用者同用途未使用的 token，再存新 token 的雜湊（不存原文）', async () => {
    const { db, queries } = fakeDb();
    const { raw, expiresAt } = await issueAuthToken(db as never, {
      userId: 'u1',
      purpose: 'password_reset',
      validSeconds: 7200,
    });

    expect(queries.map((q) => q.kind)).toEqual(['update', 'insert']);
    const [revoke, insert] = queries;
    expect(revoke!.arg('update')).toBe(authTokens);
    expect(revoke!.arg('set')).toEqual({ usedAt: NOW });
    const where = render(revoke!.arg('where'));
    expect(where.sql).toContain('"auth_tokens"."user_id" = $1');
    expect(where.sql).toContain('"auth_tokens"."purpose" = $2');
    expect(where.sql).toContain('"auth_tokens"."used_at" is null');
    expect(where.params).toEqual(['u1', 'password_reset']);

    expect(raw).toMatch(/^[\w-]{43}$/);
    expect(expiresAt).toEqual(new Date(NOW.getTime() + 7_200_000));
    expect(insert!.arg('values')).toEqual({
      userId: 'u1',
      purpose: 'password_reset',
      tokenHash: sha256(raw),
      expiresAt,
    });
  });

  it('每次簽發的原文都不同', async () => {
    const a = await issueAuthToken(fakeDb().db as never, {
      userId: 'u1',
      purpose: 'activation',
      validSeconds: 60,
    });
    const b = await issueAuthToken(fakeDb().db as never, {
      userId: 'u1',
      purpose: 'activation',
      validSeconds: 60,
    });
    expect(a.raw).not.toBe(b.raw);
  });
});
