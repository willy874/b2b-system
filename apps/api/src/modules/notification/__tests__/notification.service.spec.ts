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
import { decodeNotificationCursor, encodeNotificationCursor } from '../notification.cursor';
import { defineNotification } from '../notification.definition';
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

/** 列表的一列（自己的、未讀、系統觸發）。 */
function ownRow(i: number, createdAt = NOW) {
  return {
    id: recipient(i),
    recipientId: ME.id,
    type: 'sample.happened',
    params: {},
    link: null,
    actorId: null,
    actor: null,
    readAt: null,
    createdAt,
    sourceId: null,
  };
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
    deleteOwn: ReturnType<typeof vi.fn>;
    deleteReadBefore: ReturnType<typeof vi.fn>;
    deleteBeyondPerRecipient: ReturnType<typeof vi.fn>;
    listAll: ReturnType<typeof vi.fn>;
    countUnread: ReturnType<typeof vi.fn>;
    countBySources: ReturnType<typeof vi.fn>;
    markSourceRead: ReturnType<typeof vi.fn>;
    deleteBySource: ReturnType<typeof vi.fn>;
  };
  let events: { publish: ReturnType<typeof vi.fn> };
  let policy: {
    filterRecipients: ReturnType<typeof vi.fn>;
    isEnabled: ReturnType<typeof vi.fn>;
    hiddenTypes: ReturnType<typeof vi.fn>;
  };
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
      deleteOwn: vi.fn(async () => true),
      deleteReadBefore: vi.fn(async () => 0),
      deleteBeyondPerRecipient: vi.fn(async () => 0),
      listAll: vi.fn(async () => ({ items: [], lastCreatedAt: undefined })),
      countUnread: vi.fn(async () => 0),
      countBySources: vi.fn(async () => []),
      markSourceRead: vi.fn(async () => undefined),
      deleteBySource: vi.fn(async () => []),
    };
    events = { publish: vi.fn(() => order.push('publish')) };
    disabled = new Set();
    policy = {
      filterRecipients: vi.fn(async (type: string, _channel: string, ids: string[]) =>
        disabled.has(type) ? [] : ids.filter((id) => !optedOut.has(id)),
      ),
      isEnabled: vi.fn(async (type: string) => !disabled.has(type)),
      hiddenTypes: vi.fn(() => []),
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
    it('在呼叫端的交易內一次寫入；提交之後才推播，一批只發一則事件，每位收件人只帶自己的通知 id', async () => {
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
      expect(order).toEqual(['end of transaction body', 'commit', 'publish']);
      expect(events.publish).toHaveBeenCalledWith('resource.changed', {
        changes: [],
        perRecipient: [
          {
            userId: recipient(1),
            changes: [
              { resource: 'notification', kind: 'create', id: 'n0' },
              { resource: 'notification', kind: 'create', id: 'n2' },
            ],
          },
          {
            userId: recipient(2),
            changes: [{ resource: 'notification', kind: 'create', id: 'n1' }],
          },
        ],
      });
    });

    it('一批 500 人只發 1 則事件，帶每個人自己的通知 id（docs/architecture/backend/08-realtime.md §7.1）', async () => {
      const { db } = fakeDb(order);
      const inputs = Array.from({ length: 500 }, (_, i) => input(recipient(i + 1)));
      await withTransaction(db, (t) => service.notify(inputs, t));

      expect(events.publish).toHaveBeenCalledTimes(1);
      const [, payload] = events.publish.mock.calls[0] as unknown as [
        string,
        { changes: unknown[]; perRecipient: Array<{ userId: string; changes: unknown[] }> },
      ];
      expect(payload.changes).toEqual([]);
      expect(payload.perRecipient).toHaveLength(500);
      expect(payload.perRecipient[42]).toEqual({
        userId: recipient(43),
        changes: [{ resource: 'notification', kind: 'create', id: 'n42' }],
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
        changes: [],
        perRecipient: [
          { userId: recipient(1), changes: [{ resource: 'notification', kind: 'create' }] },
        ],
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

  describe('刪除自己的通知', () => {
    it('不是自己的或不存在 → NOTIFICATION_NOT_FOUND，不推播', async () => {
      repo.deleteOwn.mockResolvedValueOnce(false);
      await expect(service.remove(recipient(9), ME)).rejects.toMatchObject({
        code: 'NOTIFICATION_NOT_FOUND',
      });
      expect(events.publish).not.toHaveBeenCalled();
    });

    it('刪掉 → 推給自己的其他裝置（notification delete）', async () => {
      await service.remove(recipient(9), ME);
      expect(repo.deleteOwn).toHaveBeenCalledWith(recipient(9), ME.id);
      expect(events.publish).toHaveBeenCalledWith('resource.changed', {
        changes: [{ resource: 'notification', kind: 'delete', id: recipient(9) }],
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

  describe('分頁游標（docs/architecture/backend/15-notification.md §5）', () => {
    it('沒給 unread 視為 false；游標解開後交給 repository', async () => {
      const cursor = encodeNotificationCursor({ createdAt: NOW.toISOString(), id: recipient(1) });
      await service.list({ limit: 20, cursor }, ME);
      expect(repo.list).toHaveBeenCalledWith(ME.id, {
        unread: false,
        limit: 20,
        after: { createdAt: NOW.toISOString(), id: recipient(1) },
        excludeTypes: [],
      });
    });

    it('不滿一頁 → nextCursor 是 null', async () => {
      repo.list.mockResolvedValueOnce({ items: [ownRow(1)], lastCreatedAt: 'x' });
      await expect(service.list({ limit: 2 }, ME)).resolves.toMatchObject({ nextCursor: null });
    });

    it('滿一頁 → nextCursor 指向最後一筆，時間用資料庫的微秒精度字串', async () => {
      const exact = '2026-10-31T00:00:00.123456Z';
      repo.list.mockResolvedValueOnce({ items: [ownRow(1), ownRow(2)], lastCreatedAt: exact });
      const page = await service.list({ limit: 2 }, ME);
      expect(decodeNotificationCursor(page.nextCursor ?? '')).toEqual({
        createdAt: exact,
        id: recipient(2),
      });
    });

    it('滿一頁但沒有微秒字串 → 退回最後一筆的 createdAt', async () => {
      repo.list.mockResolvedValueOnce({ items: [ownRow(1)], lastCreatedAt: undefined });
      const page = await service.list({ limit: 1 }, ME);
      expect(decodeNotificationCursor(page.nextCursor ?? '')).toEqual({
        createdAt: NOW.toISOString(),
        id: recipient(1),
      });
    });

    it('listAll：篩選原樣交給 repository、帶收件人；游標格式不對 → VALIDATION_FAILED', async () => {
      const from = new Date('2026-10-01T00:00:00.000Z');
      repo.listAll.mockResolvedValueOnce({
        items: [{ ...ownRow(1), recipient: { id: ME.id, name: '我' } }],
        lastCreatedAt: undefined,
      });
      const page = await service.listAll({ limit: 1, type: 'sample.happened', from });
      expect(repo.listAll).toHaveBeenCalledWith(
        {
          type: 'sample.happened',
          recipientId: undefined,
          actorId: undefined,
          unread: false,
          from,
          to: undefined,
        },
        { limit: 1, after: undefined, excludeTypes: [] },
      );
      expect(page.items[0]).toMatchObject({
        id: recipient(1),
        recipient: { id: ME.id, name: '我' },
      });
      expect(page.nextCursor).not.toBeNull();
      await expect(service.listAll({ limit: 1, cursor: 'garbage' })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { field: 'cursor' },
      });
    });
  });

  describe('其他讀取與已讀（docs/architecture/backend/15-notification.md §12.2 D9）', () => {
    it('unreadCount 只算自己的', async () => {
      repo.countUnread.mockResolvedValueOnce(4);
      await expect(service.unreadCount(ME)).resolves.toEqual({ count: 4 });
      expect(repo.countUnread).toHaveBeenCalledWith(ME.id, []);
    });

    it('所屬 feature 沒有開放的類型不列、不算未讀（docs/architecture/05-tenancy.md §15.2 D6）', async () => {
      policy.hiddenTypes.mockReturnValue(['webhook.disabled']);
      await service.list({ limit: 20 }, ME);
      expect(repo.list).toHaveBeenCalledWith(
        ME.id,
        expect.objectContaining({ excludeTypes: ['webhook.disabled'] }),
      );
      await service.unreadCount(ME);
      expect(repo.countUnread).toHaveBeenCalledWith(ME.id, ['webhook.disabled']);
    });

    it('標為已讀之後讀回前被清理刪掉 → NOTIFICATION_NOT_FOUND，不推播', async () => {
      repo.findOwn.mockResolvedValueOnce(undefined);
      await expect(service.markRead(recipient(9), ME)).rejects.toMatchObject({
        code: 'NOTIFICATION_NOT_FOUND',
      });
      expect(events.publish).not.toHaveBeenCalled();
    });
  });

  describe('事件管理的委派（docs/architecture/backend/16-notification-event.md §9.2 D6、D14）', () => {
    const KIND = defineNotification('sample.happened', { category: 'sample', channels: ['email'] });

    it('isChannelEnabled 以類型名稱問租戶政策', async () => {
      disabled.add('sample.happened');
      await expect(service.isChannelEnabled(KIND, 'email')).resolves.toBe(false);
      expect(policy.isEnabled).toHaveBeenCalledWith('sample.happened', 'email', undefined);
    });

    it('filterRecipients 以類型名稱交給租戶政策（含個人設定）', async () => {
      optedOut.add(recipient(2));
      await expect(
        service.filterRecipients(KIND, 'email', [recipient(1), recipient(2)]),
      ).resolves.toEqual([recipient(1)]);
    });
  });

  describe('來源（docs/architecture/backend/19-announcement.md §9.2 D4、D18）', () => {
    it('statsBySources：沒有通知的來源回 0／0', async () => {
      repo.countBySources.mockResolvedValueOnce([{ sourceId: 's1', total: 5, read: 2 }]);
      const stats = await service.statsBySources(['s1', 's2']);
      expect(Object.fromEntries(stats)).toEqual({
        s1: { total: 5, read: 2 },
        s2: { total: 0, read: 0 },
      });
    });

    it('markSourceRead：沒有收到 → false，不推播', async () => {
      await expect(service.markSourceRead('s1', ME.id)).resolves.toBe(false);
      expect(events.publish).not.toHaveBeenCalled();
    });

    it('markSourceRead：原本未讀 → true，推給自己', async () => {
      repo.markSourceRead.mockResolvedValueOnce({ id: recipient(1), wasUnread: true });
      await expect(service.markSourceRead('s1', ME.id)).resolves.toBe(true);
      expect(events.publish).toHaveBeenCalledWith('resource.changed', {
        changes: [{ resource: 'notification', kind: 'update', id: recipient(1) }],
        affectedUserIds: [ME.id],
      });
    });

    it('markSourceRead：早就讀過 → true，不推播', async () => {
      repo.markSourceRead.mockResolvedValueOnce({ id: recipient(1), wasUnread: false });
      await expect(service.markSourceRead('s1', ME.id)).resolves.toBe(true);
      expect(events.publish).not.toHaveBeenCalled();
    });

    it('removeBySource：分批刪到少於一批為止，回傳總數；每批推一則 delete，各收件人只帶自己的', async () => {
      const full = Array.from({ length: NOTIFICATION_CLEANUP_BATCH_SIZE }, (_, i) => ({
        id: `n${i}`,
        recipientId: recipient(1),
      }));
      repo.deleteBySource
        .mockResolvedValueOnce(full)
        .mockResolvedValueOnce([{ id: 'last', recipientId: recipient(2) }]);
      await expect(service.removeBySource('s1')).resolves.toBe(NOTIFICATION_CLEANUP_BATCH_SIZE + 1);
      expect(repo.deleteBySource).toHaveBeenCalledTimes(2);
      expect(repo.deleteBySource).toHaveBeenCalledWith('s1', NOTIFICATION_CLEANUP_BATCH_SIZE);
      expect(events.publish).toHaveBeenCalledTimes(2);
      expect(events.publish).toHaveBeenLastCalledWith('resource.changed', {
        changes: [],
        perRecipient: [
          {
            userId: recipient(2),
            changes: [{ resource: 'notification', kind: 'delete', id: 'last' }],
          },
        ],
      });
    });

    it('removeBySource：沒有通知 → 0，不推播', async () => {
      await expect(service.removeBySource('s1')).resolves.toBe(0);
      expect(events.publish).not.toHaveBeenCalled();
    });
  });

  describe('NotificationCleanupJob.run（docs/architecture/backend/15-notification.md §12.2 D10）', () => {
    it('執行時跑一輪保留清理並回傳報告（存成背景工作的 output）', async () => {
      vi.useFakeTimers({ now: NOW });
      try {
        const job = new NotificationCleanupJob(
          service,
          { register: vi.fn() } as unknown as JobQueue,
          { get: vi.fn() } as unknown as ConfigService<Env, true>,
        );
        await expect(job.run()).resolves.toMatchObject({
          retentionDays: 30,
          cutoff: new Date(NOW.getTime() - 30 * DAY_MS).toISOString(),
        });
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
