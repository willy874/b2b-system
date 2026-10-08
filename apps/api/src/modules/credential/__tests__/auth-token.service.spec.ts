import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authTokens } from '@/db/schema';

import { AuthTokenService } from '../auth-token.service';
import { ACTIVATION_TTL_HOURS_SETTING, PASSWORD_RESET_TTL_HOURS_SETTING } from '../auth.settings';
import { sha256 } from '../token-hash';
import { fakeDb, render } from './fake-db';

const NOW = new Date('2026-10-08T00:00:00.000Z');

function setup(results: unknown[] = []) {
  const { db, queries } = fakeDb(results);
  const settings = {
    get: vi.fn(async (definition: unknown) =>
      definition === ACTIVATION_TTL_HOURS_SETTING ? 48 : 2,
    ),
  };
  const service = new AuthTokenService(db as never, settings as never);
  return { service, queries, settings, db };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    userId: 'u1',
    purpose: 'activation',
    tokenHash: sha256('raw'),
    usedAt: null,
    expiresAt: new Date(NOW.getTime() + 60_000),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AuthTokenService（docs/architecture/backend/04-auth.md §5、§8）', () => {
  describe('issue', () => {
    it('啟用 token 的有效時數讀 auth.activationTtlHours，到期時間與回傳的時數一致', async () => {
      const { service, settings, queries } = setup();
      const result = await service.issue('u1', 'activation');
      expect(settings.get).toHaveBeenCalledWith(ACTIVATION_TTL_HOURS_SETTING);
      expect(result.validHours).toBe(48);
      expect(result.expiresAt).toEqual(new Date(NOW.getTime() + 48 * 3_600_000));
      expect(queries.map((q) => q.kind)).toEqual(['update', 'insert']);
      expect(queries[1]!.arg('values')).toMatchObject({
        userId: 'u1',
        purpose: 'activation',
        tokenHash: sha256(result.raw),
      });
    });

    it('重設 token 讀 auth.passwordResetTtlHours，並使用呼叫端給的交易', async () => {
      const { service, settings, queries } = setup();
      const tx = fakeDb();
      const result = await service.issue('u1', 'password_reset', tx.db as never);
      expect(settings.get).toHaveBeenCalledWith(PASSWORD_RESET_TTL_HOURS_SETTING);
      expect(result.validHours).toBe(2);
      expect(queries).toHaveLength(0);
      expect(tx.queries.map((q) => q.kind)).toEqual(['update', 'insert']);
    });
  });

  describe('findUsable', () => {
    it('以原文的雜湊與用途查詢，可用時回傳該列', async () => {
      const found = row();
      const { service, queries } = setup([[found]]);
      await expect(service.findUsable('raw', 'activation')).resolves.toBe(found);
      const where = render(queries[0]!.arg('where'));
      expect(where.params).toEqual([sha256('raw'), 'activation']);
      expect(queries[0]!.arg('limit')).toBe(1);
    });

    it('找不到 → undefined', async () => {
      const { service } = setup([[]]);
      await expect(service.findUsable('raw', 'activation')).resolves.toBeUndefined();
    });

    it('已使用 → undefined', async () => {
      const { service } = setup([[row({ usedAt: new Date(NOW.getTime() - 1) })]]);
      await expect(service.findUsable('raw', 'activation')).resolves.toBeUndefined();
    });

    it('已過期 → undefined', async () => {
      const { service } = setup([[row({ expiresAt: new Date(NOW.getTime() - 1) })]]);
      await expect(service.findUsable('raw', 'activation')).resolves.toBeUndefined();
    });
  });

  describe('markUsed（併發的雙擊只有一個成功）', () => {
    it('條件式更新命中一列 → true，條件含尚未使用與尚未過期', async () => {
      const { service, queries } = setup([[{ id: 't1' }]]);
      await expect(service.markUsed('t1')).resolves.toBe(true);
      expect(queries[0]!.arg('update')).toBe(authTokens);
      expect(queries[0]!.arg('set')).toEqual({ usedAt: NOW });
      const where = render(queries[0]!.arg('where'));
      expect(where.sql).toContain('"auth_tokens"."used_at" is null');
      expect(where.sql).toContain('"auth_tokens"."expires_at" > now()');
      expect(where.params).toEqual(['t1']);
    });

    it('沒有命中（被別的請求先用掉）→ false；有交易時用交易', async () => {
      const { service, queries } = setup();
      const tx = fakeDb([[]]);
      await expect(service.markUsed('t1', tx.db as never)).resolves.toBe(false);
      expect(queries).toHaveLength(0);
      expect(tx.queries).toHaveLength(1);
    });
  });

  describe('revokeUnused（停用、刪除帳號）', () => {
    it('把使用者所有未使用的 token 標成已使用', async () => {
      const { service, queries } = setup();
      await service.revokeUnused('u1');
      expect(queries[0]!.arg('set')).toEqual({ usedAt: NOW });
      const where = render(queries[0]!.arg('where'));
      expect(where.sql).toContain('"auth_tokens"."used_at" is null');
      expect(where.params).toEqual(['u1']);
    });

    it('有交易時在交易內執行', async () => {
      const { service, queries } = setup();
      const tx = fakeDb();
      await service.revokeUnused('u1', tx.db as never);
      expect(queries).toHaveLength(0);
      expect(tx.queries[0]!.kind).toBe('update');
    });
  });

  describe('deleteStaleBatch（清理排程）', () => {
    it('以保留天數篩出最多 batchSize 列刪除，回傳刪除的筆數', async () => {
      const { service, queries } = setup([[{ id: 'a' }, { id: 'b' }]]);
      await expect(service.deleteStaleBatch(30, 500)).resolves.toBe(2);
      const [stale, del] = queries;
      expect(stale!.kind).toBe('select');
      expect(stale!.arg('limit')).toBe(500);
      const staleWhere = render(stale!.arg('where'));
      expect(staleWhere.sql).toContain('make_interval(days => $1::int)');
      expect(staleWhere.params).toEqual([30, 30]);
      expect(del!.kind).toBe('delete');
      expect(del!.arg('delete')).toBe(authTokens);
    });
  });
});
