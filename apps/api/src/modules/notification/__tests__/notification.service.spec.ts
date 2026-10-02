import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import type { Env } from '@/core/config';
import { withTransaction } from '@/core/database';
import type { Database, Transaction } from '@/core/database';
import type { DomainEventBus } from '@/core/events';
import type { JobQueue } from '@/core/jobs';
import type { SettingService } from '@/core/settings';

import { NOTIFICATION_CLEANUP_JOB, NotificationCleanupJob } from '../notification-cleanup.job';
import type { NotificationPolicyService } from '../notification-policy.service';
import {
  MAX_NOTIFICATION_RECIPIENTS,
  NOTIFICATION_CLEANUP_BATCH_SIZE,
} from '../notification.constants';
import type { NotificationInput } from '../notification.definition';
import type { NotificationRepository } from '../notification.repository';
import { NotificationService } from '../notification.service';

const NOW = new Date('2026-10-31T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const ME: AuthUser = {
  id: '00000000-0000-4000-8000-0000000000aa',
  email: 'me@x',
  status: 'active',
};

function recipient(i: number): string {
  return `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
}

function input(recipientId: string, type = 'sample.happened'): NotificationInput {
  return { type, recipientId, actorId: null, params: {}, link: null };
}

/** 假的 db：`withTransaction` 以它開交易，提交後的 hook 照真的順序執行。 */
function fakeDb(order: string[]) {
  const tx = { name: 'tx' };
  return {
    tx,
    db: {
      transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => {
        const result = await fn(tx);
        order.push('commit');
        return result;
      }),
    } as unknown as Database,
  };
}

describe('NotificationService（docs/architecture/backend/15-notification.md）', () => {
  let repo: {
    insertMany: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
    findOwn: ReturnType<typeof vi.fn>;
    markRead: ReturnType<typeof vi.fn>;
    markAllRead: ReturnType<typeof vi.fn>;
    deleteReadBefore: ReturnType<typeof vi.fn>;
    deleteBeyondPerRecipient: ReturnType<typeof vi.fn>;
  };
  let events: { publish: ReturnType<typeof vi.fn> };
  let policy: { filterRecipients: ReturnType<typeof vi.fn> };
  /** 租戶關掉站內通知的類型。 */
  let disabled: Set<string>;
  /** 自己關掉的收件人。 */
  let optedOut: Set<string>;
  let service: NotificationService;
  let order: string[];

  beforeEach(() => {
    order = [];
    repo = {
      insertMany: vi.fn(async (rows: NotificationInput[]) =>
        rows.map((row, i) => ({ id: `n${i}`, recipientId: row.recipientId })),
      ),
      list: vi.fn(async () => ({ items: [], lastCreatedAt: undefined })),
      findOwn: vi.fn(),
      markRead: vi.fn(async () => true),
      markAllRead: vi.fn(async () => 0),
      deleteReadBefore: vi.fn(async () => 0),
      deleteBeyondPerRecipient: vi.fn(async () => 0),
    };
    events = { publish: vi.fn(() => order.push('publish')) };
    disabled = new Set();
    policy = {
      filterRecipients: vi.fn(async (type: string, _channel: string, ids: string[]) =>
        disabled.has(type) ? [] : ids.filter((id) => !optedOut.has(id)),
      ),
    };
    optedOut = new Set();
    const settings = {
      get: vi.fn(async (setting: { key: string }) =>
        setting.key === 'notification.retentionDays' ? 30 : 500,
      ),
    } as unknown as SettingService;
    service = new NotificationService(
      repo as unknown as NotificationRepository,
      events as unknown as DomainEventBus,
      settings,
      policy as unknown as NotificationPolicyService,
    );
  });

  describe('notify（docs/architecture/backend/15-notification.md §12.2 D2、D6、D7、D8）', () => {
    it('在呼叫端的交易內一次寫入；提交之後才推播，每位收件人一則、只帶自己的通知 id', async () => {
      const { db, tx } = fakeDb(order);
      const ids = await withTransaction(db, async (t) => {
        const written = await service.notify(
          [input(recipient(1)), input(recipient(2)), input(recipient(1), 'sample.other')],
          t,
        );
        order.push('end of transaction body');
        return written;
      });

      expect(ids).toEqual(['n0', 'n1', 'n2']);
      expect(repo.insertMany).toHaveBeenCalledTimes(1);
      expect(repo.insertMany.mock.calls[0]?.[1]).toBe(tx);
      expect(order).toEqual(['end of transaction body', 'commit', 'publish', 'publish']);
      expect(events.publish).toHaveBeenCalledWith('resource.changed', {
        changes: [
          { resource: 'notification', kind: 'create', id: 'n0' },
          { resource: 'notification', kind: 'create', id: 'n2' },
        ],
        affectedUserIds: [recipient(1)],
      });
      expect(events.publish).toHaveBeenCalledWith('resource.changed', {
        changes: [{ resource: 'notification', kind: 'create', id: 'n1' }],
        affectedUserIds: [recipient(2)],
      });
    });

    it('租戶關掉某類型的站內通知 → 那一類不寫，其他類型照寫（docs/architecture/backend/16-notification-event.md §9.2 D6）', async () => {
      disabled.add('sample.other');
      const { db, tx } = fakeDb(order);
      const ids = await withTransaction(db, (t) =>
        service.notify([input(recipient(1)), input(recipient(2), 'sample.other')], t),
      );
      expect(ids).toEqual(['n0']);
      expect(repo.insertMany.mock.calls[0]?.[0]).toEqual([input(recipient(1))]);
      // 每種類型查一次，交易內的查詢沿用交易
      expect(policy.filterRecipients).toHaveBeenCalledTimes(2);
      expect(policy.filterRecipients).toHaveBeenCalledWith(
        'sample.other',
        'inApp',
        [recipient(2)],
        tx,
      );
    });

    it('收件人自己關掉 → 只略過那個人，同一類型的其他人照寫；一種類型只查一次（docs/architecture/backend/16-notification-event.md §9.2 D14、D15）', async () => {
      optedOut.add(recipient(2));
      const { db } = fakeDb(order);
      const ids = await withTransaction(db, (t) =>
        service.notify([input(recipient(1)), input(recipient(2)), input(recipient(3))], t),
      );
      expect(ids).toEqual(['n0', 'n1']);
      expect(repo.insertMany.mock.calls[0]?.[0]).toEqual([
        input(recipient(1)),
        input(recipient(3)),
      ]);
      expect(policy.filterRecipients).toHaveBeenCalledTimes(1);
    });

    it('全部都是操作者自己 → 仍檢查類型有沒有登記（以空的收件人查）', async () => {
      const { db } = fakeDb(order);
      await withTransaction(db, (t) =>
        service.notify({ ...input(recipient(1)), actorId: recipient(1) }, t),
      );
      expect(policy.filterRecipients).toHaveBeenCalledWith(
        'sample.happened',
        'inApp',
        [],
        expect.anything(),
      );
    });

    it('全部都被租戶關掉 → 不寫入也不推播', async () => {
      disabled.add('sample.happened');
      const { db } = fakeDb(order);
      const ids = await withTransaction(db, (t) => service.notify(input(recipient(1)), t));
      expect(ids).toEqual([]);
      expect(repo.insertMany).not.toHaveBeenCalled();
      expect(events.publish).not.toHaveBeenCalled();
    });

    it('類型沒有登記進事件目錄 → 拋錯，業務交易一起失敗（docs/architecture/backend/16-notification-event.md §9.2 D2）', async () => {
      policy.filterRecipients.mockRejectedValueOnce(new Error('通知類型 sample.happened 沒有登記'));
      const { db } = fakeDb(order);
      await expect(
        withTransaction(db, (t) => service.notify(input(recipient(1)), t)),
      ).rejects.toThrow(/沒有登記/);
      expect(repo.insertMany).not.toHaveBeenCalled();
    });

    it('交易 rollback → 不推播', async () => {
      const { db } = fakeDb(order);
      await expect(
        withTransaction(db, async (t) => {
          await service.notify(input(recipient(1)), t);
          throw new Error('業務失敗');
        }),
      ).rejects.toThrow('業務失敗');
      expect(events.publish).not.toHaveBeenCalled();
    });

    it('全部都被略過（操作者自己）→ 不寫入也不推播', async () => {
      const { db } = fakeDb(order);
      const ids = await withTransaction(db, (t) =>
        service.notify({ ...input(recipient(1)), actorId: recipient(1) }, t),
      );
      expect(ids).toEqual([]);
      expect(repo.insertMany).not.toHaveBeenCalled();
      expect(events.publish).not.toHaveBeenCalled();
    });

    it(`超過 ${MAX_NOTIFICATION_RECIPIENTS} 位收件人 → 記 warn 並截斷，業務照常成功`, async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      const { db } = fakeDb(order);
      const inputs = Array.from({ length: MAX_NOTIFICATION_RECIPIENTS + 5 }, (_, i) =>
        input(recipient(i + 1)),
      );
      await withTransaction(db, (t) => service.notify(inputs, t));
      expect(repo.insertMany.mock.calls[0]?.[0]).toHaveLength(MAX_NOTIFICATION_RECIPIENTS);
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ truncated: 5, kept: MAX_NOTIFICATION_RECIPIENTS }),
        expect.stringContaining('上限'),
      );
      warn.mockRestore();
    });

    it('一位收件人一次超過 100 則 → 推一筆不帶 id 的變更', async () => {
      repo.insertMany.mockImplementation(async (rows: NotificationInput[]) =>
        rows.map((_, i) => ({ id: `n${i}`, recipientId: recipient(1) })),
      );
      const { db } = fakeDb(order);
      const inputs = Array.from({ length: 101 }, (_, i) => input(recipient(1), `sample.t${i}`));
      await withTransaction(db, (t) => service.notify(inputs, t));
      expect(events.publish).toHaveBeenCalledWith('resource.changed', {
        changes: [{ resource: 'notification', kind: 'create' }],
        affectedUserIds: [recipient(1)],
      });
    });

    it('不是 withTransaction 開的交易 → 拋錯（登記不了提交後的推播）', async () => {
      await expect(service.notify(input(recipient(1)), {} as Transaction)).rejects.toThrow(
        /afterCommit/,
      );
    });
  });

  describe('讀取與已讀（docs/architecture/backend/15-notification.md §12.2 D9）', () => {
    it('游標格式不對 → VALIDATION_FAILED（field: cursor）', async () => {
      await expect(service.list({ limit: 20, cursor: 'garbage' }, ME)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { field: 'cursor' },
      });
    });

    it('不是自己的或不存在 → NOTIFICATION_NOT_FOUND，不推播', async () => {
      repo.markRead.mockResolvedValueOnce(false);
      await expect(service.markRead(recipient(9), ME)).rejects.toMatchObject({
        code: 'NOTIFICATION_NOT_FOUND',
      });
      expect(events.publish).not.toHaveBeenCalled();
    });

    it('標為已讀 → 推給自己的其他裝置（notification update）', async () => {
      repo.findOwn.mockResolvedValueOnce({
        id: recipient(9),
        recipientId: ME.id,
        type: 'sample.happened',
        params: {},
        link: null,
        actorId: null,
        actor: null,
        readAt: NOW,
        createdAt: NOW,
      });
      await expect(service.markRead(recipient(9), ME)).resolves.toMatchObject({
        id: recipient(9),
        readAt: NOW.toISOString(),
      });
      expect(events.publish).toHaveBeenCalledWith('resource.changed', {
        changes: [{ resource: 'notification', kind: 'update', id: recipient(9) }],
        affectedUserIds: [ME.id],
      });
    });

    it('全部已讀：沒有未讀的就不推播', async () => {
      await expect(service.markAllRead(ME)).resolves.toEqual({ updated: 0 });
      expect(events.publish).not.toHaveBeenCalled();
      repo.markAllRead.mockResolvedValueOnce(3);
      await expect(service.markAllRead(ME)).resolves.toEqual({ updated: 3 });
      expect(events.publish).toHaveBeenCalledWith('resource.changed', {
        changes: [{ resource: 'notification', kind: 'update' }],
        affectedUserIds: [ME.id],
      });
    });
  });

  describe('cleanup（docs/architecture/backend/15-notification.md §12.2 D10）', () => {
    it('依設定算出期限，兩種刪除各自分批做到少於一批為止', async () => {
      repo.deleteReadBefore
        .mockResolvedValueOnce(NOTIFICATION_CLEANUP_BATCH_SIZE)
        .mockResolvedValueOnce(7);
      repo.deleteBeyondPerRecipient.mockResolvedValueOnce(2);
      const report = await service.cleanup(NOW);

      const cutoff = new Date(NOW.getTime() - 30 * DAY_MS);
      expect(repo.deleteReadBefore).toHaveBeenCalledTimes(2);
      expect(repo.deleteReadBefore).toHaveBeenCalledWith(cutoff, NOTIFICATION_CLEANUP_BATCH_SIZE);
      expect(repo.deleteBeyondPerRecipient).toHaveBeenCalledWith(
        500,
        NOTIFICATION_CLEANUP_BATCH_SIZE,
      );
      expect(report).toEqual({
        retentionDays: 30,
        maxPerUser: 500,
        cutoff: cutoff.toISOString(),
        deletedRead: NOTIFICATION_CLEANUP_BATCH_SIZE + 7,
        deletedBeyondLimit: 2,
      });
      expect(events.publish).not.toHaveBeenCalled();
    });

    it('notification.cleanup 以 NOTIFICATION_CLEANUP_CRON 註冊成每個租戶各跑一次', () => {
      const jobs = { register: vi.fn() };
      const config = { get: vi.fn(() => '0 5 * * *') } as unknown as ConfigService<Env, true>;
      new NotificationCleanupJob(service, jobs as unknown as JobQueue, config).onModuleInit();
      expect(NOTIFICATION_CLEANUP_JOB.options).toMatchObject({ scope: 'tenant', exclusive: true });
      expect(jobs.register).toHaveBeenCalledWith(NOTIFICATION_CLEANUP_JOB, expect.any(Function), {
        cron: '0 5 * * *',
      });
      expect(config.get).toHaveBeenCalledWith('NOTIFICATION_CLEANUP_CRON', { infer: true });
    });
  });
});
