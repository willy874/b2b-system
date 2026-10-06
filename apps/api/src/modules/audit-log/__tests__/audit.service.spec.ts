import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database, DbOrTx } from '@/core/database';
import { runWithRequestContext } from '@/core/http';
import type { RequestContext } from '@/core/http';
import { auditLogs } from '@/db/schema';

import { AuditService } from '../audit.service';

const NOW = new Date('2026-10-06T08:00:00.000Z');

/** 假的 db／tx：記下 insert 的表與寫入的值。 */
function fakeDb(fail?: Error) {
  const values = vi.fn(async (_row: Record<string, unknown>) => {
    if (fail) throw fail;
  });
  const insert = vi.fn((_table: unknown) => ({ values }));
  return { db: { insert }, insert, values };
}

const CONTEXT: RequestContext = {
  requestId: 'req-1',
  ip: '203.0.113.7',
  userAgent: 'vitest',
  user: { id: 'u-ctx', email: 'ctx@example.com' },
};

function written(values: ReturnType<typeof fakeDb>['values']): Record<string, unknown> {
  const row = values.mock.calls[0]?.[0];
  if (!row) throw new Error('沒有寫入稽核');
  return row;
}

describe('AuditService（docs/architecture/backend/06-audit-log.md §4）', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('record', () => {
    it('傳入 tx → 寫在呼叫端的交易裡（與業務變更同生共死），不用預設的連線', async () => {
      const base = fakeDb();
      const tx = fakeDb();
      await new AuditService(base.db as unknown as Database).record(
        { action: 'role.update', resourceType: 'role' },
        tx.db as unknown as DbOrTx,
      );
      expect(tx.insert).toHaveBeenCalledWith(auditLogs);
      expect(base.insert).not.toHaveBeenCalled();
    });

    it('沒傳 tx → 用預設的連線', async () => {
      const base = fakeDb();
      await new AuditService(base.db as unknown as Database).record({
        action: 'auth.login',
        resourceType: 'auth',
      });
      expect(base.insert).toHaveBeenCalledWith(auditLogs);
    });

    it('沒有請求脈絡、只給必填 → 操作者是 system，其餘補 null，result 為 success', async () => {
      const { db, values } = fakeDb();
      await new AuditService(db as unknown as Database).record({
        action: 'trash.purge',
        resourceType: 'user',
      });
      expect(written(values)).toEqual({
        occurredAt: NOW,
        actorId: null,
        actorEmail: 'system',
        action: 'trash.purge',
        resourceType: 'user',
        resourceId: null,
        resourceName: null,
        result: 'success',
        errorCode: null,
        changes: null,
        metadata: { ip: undefined, userAgent: undefined, requestId: undefined },
      });
    });

    it('請求脈絡裡的使用者成為操作者，metadata 帶 ip、userAgent、requestId', async () => {
      const { db, values } = fakeDb();
      await runWithRequestContext(CONTEXT, () =>
        new AuditService(db as unknown as Database).record({
          action: 'user.update',
          resourceType: 'user',
        }),
      );
      expect(written(values)).toMatchObject({
        actorId: 'u-ctx',
        actorEmail: 'ctx@example.com',
        metadata: { ip: '203.0.113.7', userAgent: 'vitest', requestId: 'req-1' },
      });
    });

    it('明確給的操作者優先於請求脈絡', async () => {
      const { db, values } = fakeDb();
      await runWithRequestContext(CONTEXT, () =>
        new AuditService(db as unknown as Database).record({
          action: 'job.retry',
          resourceType: 'job',
          actorId: 'u-explicit',
          actorEmail: 'explicit@example.com',
        }),
      );
      expect(written(values)).toMatchObject({
        actorId: 'u-explicit',
        actorEmail: 'explicit@example.com',
      });
    });

    it('input.metadata 與請求資訊合併，同名鍵以 input 為準', async () => {
      const { db, values } = fakeDb();
      await runWithRequestContext(CONTEXT, () =>
        new AuditService(db as unknown as Database).record({
          action: 'authz.denied',
          resourceType: 'authz',
          metadata: { route: 'GET /trash', requestId: 'override' },
        }),
      );
      expect(written(values).metadata).toEqual({
        ip: '203.0.113.7',
        userAgent: 'vitest',
        requestId: 'override',
        route: 'GET /trash',
      });
    });

    it('失敗的操作帶 result、errorCode；changes 原樣寫入', async () => {
      const { db, values } = fakeDb();
      const changes = { before: { name: 'A' }, after: { name: 'B' } };
      await new AuditService(db as unknown as Database).record({
        action: 'role.update',
        resourceType: 'role',
        resourceId: 'r-1',
        resourceName: 'Editors',
        result: 'failure',
        errorCode: 'ROLE_VERSION_CONFLICT',
        changes,
      });
      expect(written(values)).toMatchObject({
        resourceId: 'r-1',
        resourceName: 'Editors',
        result: 'failure',
        errorCode: 'ROLE_VERSION_CONFLICT',
        changes,
      });
    });

    it('寫入失敗 → 往外拋（無紀錄則無操作，§4.2）', async () => {
      const { db } = fakeDb(new Error('insert failed'));
      await expect(
        new AuditService(db as unknown as Database).record({
          action: 'role.update',
          resourceType: 'role',
        }),
      ).rejects.toThrow('insert failed');
    });
  });

  describe('recordSafely（交易外的稽核）', () => {
    it('寫入成功 → 與 record 相同（用預設的連線）', async () => {
      const { db, values } = fakeDb();
      await new AuditService(db as unknown as Database).recordSafely({
        action: 'auth.login',
        resourceType: 'auth',
        result: 'failure',
      });
      expect(written(values)).toMatchObject({ action: 'auth.login', result: 'failure' });
    });

    it('寫入失敗 → 不拋出，只記錯誤日誌（不蓋掉原本要回給使用者的錯誤）', async () => {
      const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      const { db } = fakeDb(new Error('insert failed'));
      await expect(
        new AuditService(db as unknown as Database).recordSafely({
          action: 'authz.denied',
          resourceType: 'authz',
        }),
      ).resolves.toBeUndefined();
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'authz.denied' }),
        expect.any(String),
      );
    });
  });
});
