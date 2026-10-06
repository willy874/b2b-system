import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/core/database';
import { DomainEvent } from '@/core/events';
import type { DomainEventBus } from '@/core/events';
import type { JobQueue } from '@/core/jobs';
import type { SettingService } from '@/core/settings';
import type {
  AnnouncementAudienceValue,
  AnnouncementDispatchRow,
  AnnouncementRecurringTrigger,
  AnnouncementRow,
} from '@/db/schema';
import type { NotificationInput } from '@/modules/notification/notification.definition';
import type { NotificationService } from '@/modules/notification/notification.service';

import { AnnouncementDispatchService } from '../announcement-dispatch.service';
import type { AnnouncementAudienceResolver, ResolvedAudience } from '../announcement.audience';
import type { AnnouncementEventDispatchJobData } from '../announcement.job-types';
import type { AnnouncementRepository } from '../announcement.repository';
import {
  announcement,
  AUDIENCE,
  catalog,
  dispatchRow,
  fakeDatabase,
  fakeJobs,
  fakeSettings,
  inTenant,
  NOW,
  scheduler,
} from './announcement.fixture';
import type { SettingValues } from './announcement.fixture';

const RUN_AT = '2026-10-05T01:00:00.000Z';
const NO_SKIPPED = { userIds: [], groupIds: [], roleIds: [] };
const DAILY_NINE: AnnouncementRecurringTrigger = {
  kind: 'recurring',
  frequency: 'daily',
  interval: 1,
  time: '09:00',
  startsOn: '2026-10-01',
};

interface SetupOptions {
  locked?: AnnouncementRow | undefined;
  dispatch?: AnnouncementDispatchRow | undefined;
  recipients?: string[];
  dispatchCount?: number;
  settings?: SettingValues;
}

function setup(options: SetupOptions = {}) {
  const log: string[] = [];
  const { db, tx } = fakeDatabase(log);
  const locked = 'locked' in options ? options.locked : announcement();
  const dispatch = 'dispatch' in options ? options.dispatch : dispatchRow();
  const repo = {
    lockActive: vi.fn(
      async (_id: string, _tx: unknown): Promise<AnnouncementRow | undefined> => locked,
    ),
    insertDispatch: vi.fn(
      async (
        values: Partial<AnnouncementDispatchRow>,
        _tx: unknown,
      ): Promise<AnnouncementDispatchRow | undefined> => dispatchRow({ ...values, id: 'disp-new' }),
    ),
    countDispatches: vi.fn(async (_id: string, _tx?: unknown) => options.dispatchCount ?? 1),
    setState: vi.fn(async (_id: string, _values: object, _tx: unknown) => undefined),
    listScheduled: vi.fn(
      async (): Promise<Array<Pick<AnnouncementRow, 'id' | 'trigger' | 'nextRunAt'>>> => [],
    ),
    deleteFinishedDispatchesBefore: vi.fn(async (_cutoff: Date, _limit: number) => 0),
    findDispatch: vi.fn(async (): Promise<AnnouncementDispatchRow | undefined> => dispatch),
    updateDispatch: vi.fn(async (_id: string, _values: object, _tx?: unknown) => {
      log.push('updateDispatch');
    }),
    lockDispatch: vi.fn(async (): Promise<AnnouncementDispatchRow | undefined> => dispatch),
  };
  const audience = {
    resolve: vi.fn(async (_audience: AnnouncementAudienceValue): Promise<ResolvedAudience> => ({
      userIds: options.recipients ?? ['user-1', 'user-2'],
      skipped: NO_SKIPPED,
    })),
  };
  const notifications = {
    notify: vi.fn(async (input: NotificationInput | readonly NotificationInput[], _tx: unknown) => {
      log.push('notify');
      return (Array.isArray(input) ? input : [input]).map((_item, index) => `n-${index}`);
    }),
    statsBySources: vi.fn(
      async (_ids: readonly string[]) =>
        new Map<string, { total: number; read: number }>([['disp-1', { total: 2, read: 0 }]]),
    ),
  };
  const settings = fakeSettings(options.settings);
  const jobs = fakeJobs(log);
  const events = {
    publish: vi.fn(() => {
      log.push('publish');
    }),
  };
  const service = new AnnouncementDispatchService(
    db as unknown as Database,
    repo as unknown as AnnouncementRepository,
    audience as unknown as AnnouncementAudienceResolver,
    notifications as unknown as NotificationService,
    settings as unknown as SettingService,
    jobs as unknown as JobQueue,
    scheduler(settings, jobs),
    catalog(),
    events as unknown as DomainEventBus,
  );
  return { service, db, repo, audience, notifications, settings, jobs, events, tx, log };
}

function changed(id = 'ann-1') {
  return [
    DomainEvent.RESOURCE_CHANGED,
    { changes: [{ resource: ChangeSource.ANNOUNCEMENT, kind: ChangeKind.UPDATE, id }] },
  ];
}

const DISABLED = ['file'] as const;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AnnouncementDispatchService.runScheduled（docs/architecture/backend/19-announcement.md §5、§9.2 D8、D10）', () => {
  const scheduledOnce = () =>
    announcement({
      status: 'scheduled',
      trigger: { kind: 'once', at: RUN_AT },
      nextRunAt: new Date(RUN_AT),
      updatedBy: 'publisher-1',
    });

  it('租戶停用了公告 → skipped featureDisabled，不碰資料庫（D20）', async () => {
    const ctx = setup();
    const result = await inTenant(
      () => ctx.service.runScheduled({ announcementId: 'ann-1', runAt: RUN_AT }),
      [...DISABLED],
    );
    expect(result).toEqual({ skipped: 'featureDisabled' });
    expect(ctx.db.transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['已暫停', announcement({ status: 'paused', trigger: { kind: 'once', at: RUN_AT } })],
    ['已完成', announcement({ status: 'completed', nextRunAt: new Date(RUN_AT) })],
    [
      '時間被改過（next_run_at 對不上）',
      announcement({ status: 'scheduled', nextRunAt: new Date('2026-10-09T01:00:00.000Z') }),
    ],
    ['已刪除', undefined],
  ])('%s：舊工作變成 no-op（skipped stale），不建立發送', async (_label, locked) => {
    const ctx = setup({ locked });
    const result = await inTenant(() =>
      ctx.service.runScheduled({ announcementId: 'ann-1', runAt: RUN_AT }),
    );
    expect(result).toEqual({ skipped: 'stale' });
    expect(ctx.repo.insertDispatch).not.toHaveBeenCalled();
    expect(ctx.events.publish).not.toHaveBeenCalled();
  });

  it('時間到：以內容快照建立發送，計畫時間是工作上的時間，送出者沿用最後送出或恢復的人', async () => {
    const ctx = setup({ locked: scheduledOnce() });
    await inTenant(() => ctx.service.runScheduled({ announcementId: 'ann-1', runAt: RUN_AT }));
    expect(ctx.repo.insertDispatch).toHaveBeenCalledWith(
      {
        announcementId: 'ann-1',
        scheduledFor: new Date(RUN_AT),
        title: '季度說明會',
        body: '十月的季度說明會改到線上舉行。',
        audience: AUDIENCE,
        createdBy: 'publisher-1',
      },
      ctx.tx,
    );
  });

  it('指定時間：發送後 completed，在同一個交易入列分批寫入，提交後發布', async () => {
    const ctx = setup({ locked: scheduledOnce() });
    const result = await inTenant(() =>
      ctx.service.runScheduled({ announcementId: 'ann-1', runAt: RUN_AT }),
    );
    expect(result).toEqual({ dispatchId: 'disp-new' });
    expect(ctx.repo.setState).toHaveBeenCalledWith(
      'ann-1',
      { status: 'completed', nextRunAt: null },
      ctx.tx,
    );
    expect(ctx.jobs.enqueue).toHaveBeenCalledTimes(1);
    expect(ctx.jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'announcement.fanOut' }),
      { dispatchId: 'disp-new' },
      { tx: ctx.tx },
    );
    expect(ctx.log).toEqual(['begin', 'enqueue:announcement.fanOut', 'commit', 'publish']);
    expect(ctx.events.publish).toHaveBeenCalledWith(...changed());
  });

  it('週期：排下一次並入列；停機後補發的只有這一次，下一次從現在算起（D10）', async () => {
    // 工作預定 10/03 09:00（台北），NOW 是 10/06 08:00：10/04、10/05 的不連發
    const runAt = '2026-10-03T01:00:00.000Z';
    const ctx = setup({
      locked: announcement({
        status: 'scheduled',
        trigger: DAILY_NINE,
        nextRunAt: new Date(runAt),
      }),
    });
    await inTenant(() => ctx.service.runScheduled({ announcementId: 'ann-1', runAt }));
    const next = new Date('2026-10-06T01:00:00.000Z');
    expect(ctx.repo.setState).toHaveBeenCalledWith(
      'ann-1',
      { status: 'scheduled', nextRunAt: next },
      ctx.tx,
    );
    expect(ctx.jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'announcement.dispatch' }),
      { announcementId: 'ann-1', runAt: next.toISOString() },
      { tx: ctx.tx, startAfter: next },
    );
  });

  it('工作比預定時間早一點執行（時鐘誤差）：下一次仍排在這一次之後，不重排同一個時間', async () => {
    // 預定台北 10/06 09:00，NOW 是 08:00
    const runAt = '2026-10-06T01:00:00.000Z';
    const ctx = setup({
      locked: announcement({
        status: 'scheduled',
        trigger: DAILY_NINE,
        nextRunAt: new Date(runAt),
      }),
    });
    await inTenant(() => ctx.service.runScheduled({ announcementId: 'ann-1', runAt }));
    expect(ctx.repo.setState).toHaveBeenCalledWith(
      'ann-1',
      { status: 'scheduled', nextRunAt: new Date('2026-10-07T01:00:00.000Z') },
      ctx.tx,
    );
  });

  it('週期：這一次用完次數上限就 completed，不再入列延遲工作', async () => {
    const ctx = setup({
      locked: announcement({
        status: 'scheduled',
        trigger: { ...DAILY_NINE, maxOccurrences: 3 },
        nextRunAt: new Date(RUN_AT),
      }),
      dispatchCount: 3,
    });
    await inTenant(() => ctx.service.runScheduled({ announcementId: 'ann-1', runAt: RUN_AT }));
    expect(ctx.repo.countDispatches).toHaveBeenCalledWith('ann-1', ctx.tx);
    expect(ctx.repo.setState).toHaveBeenCalledWith(
      'ann-1',
      { status: 'completed', nextRunAt: null },
      ctx.tx,
    );
    expect(ctx.jobs.enqueue).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'announcement.dispatch' }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('同一個時間已經有發送紀錄（重做）：不再入列分批寫入，回 skipped stale', async () => {
    const ctx = setup({ locked: scheduledOnce() });
    ctx.repo.insertDispatch.mockResolvedValue(undefined);
    const result = await inTenant(() =>
      ctx.service.runScheduled({ announcementId: 'ann-1', runAt: RUN_AT }),
    );
    expect(result).toEqual({ skipped: 'stale' });
    expect(ctx.jobs.enqueue).not.toHaveBeenCalled();
  });
});

const eventAnnouncement = (
  event: string,
  audience: AnnouncementAudienceValue = AUDIENCE,
): AnnouncementRow =>
  announcement({
    status: 'scheduled',
    trigger: { kind: 'event', event, delayMinutes: 0 },
    audience,
    updatedBy: 'publisher-1',
  });

describe('AnnouncementDispatchService.runEvent（docs/architecture/backend/19-announcement.md §5.3、§9.2 D12～D14）', () => {
  const job = (
    overrides: Partial<AnnouncementEventDispatchJobData> = {},
  ): AnnouncementEventDispatchJobData => ({
    announcementId: 'ann-1',
    event: 'group.memberAdded',
    userId: 'user-9',
    runAt: RUN_AT,
    groupId: 'group-1',
    ...overrides,
  });

  it('租戶停用了公告 → skipped featureDisabled', async () => {
    const ctx = setup();
    const result = await inTenant(() => ctx.service.runEvent(job()), [...DISABLED]);
    expect(result).toEqual({ skipped: 'featureDisabled' });
  });

  it('觸發點已不在目錄上 → skipped unknownEvent，不碰資料庫', async () => {
    const ctx = setup();
    const result = await inTenant(() => ctx.service.runEvent(job({ event: 'order.shipped' })));
    expect(result).toEqual({ skipped: 'unknownEvent' });
    expect(ctx.db.transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['已暫停', { ...eventAnnouncement('group.memberAdded'), status: 'paused' as const }],
    [
      '改成了指定時間',
      announcement({ status: 'scheduled', trigger: { kind: 'once', at: RUN_AT } }),
    ],
    ['改訂別的觸發點', eventAnnouncement('user.activated')],
    ['已刪除', undefined],
  ])('%s → skipped stale', async (_label, locked) => {
    const ctx = setup({ locked });
    const result = await inTenant(() => ctx.service.runEvent(job()));
    expect(result).toEqual({ skipped: 'stale' });
    expect(ctx.repo.insertDispatch).not.toHaveBeenCalled();
  });

  it('比對成立：建立只發給那個人的發送紀錄（觸發的使用者、計畫時間），入列分批寫入', async () => {
    const ctx = setup({ locked: eventAnnouncement('group.memberAdded') });
    const result = await inTenant(() => ctx.service.runEvent(job()));
    expect(result).toEqual({ dispatchId: 'disp-new' });
    expect(ctx.repo.insertDispatch).toHaveBeenCalledWith(
      {
        announcementId: 'ann-1',
        scheduledFor: new Date(RUN_AT),
        title: '季度說明會',
        body: '十月的季度說明會改到線上舉行。',
        audience: { all: false, userIds: ['user-9'], groupIds: [], roleIds: [] },
        triggerSubjectId: 'user-9',
        createdBy: 'publisher-1',
      },
      ctx.tx,
    );
    expect(ctx.jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'announcement.fanOut' }),
      { dispatchId: 'disp-new' },
      { tx: ctx.tx },
    );
    expect(ctx.log).toEqual(['begin', 'enqueue:announcement.fanOut', 'commit', 'publish']);
  });

  it('同一則公告已經發給這個人（唯一索引）→ skipped alreadySent，不入列、不發布', async () => {
    const ctx = setup({ locked: eventAnnouncement('group.memberAdded') });
    ctx.repo.insertDispatch.mockResolvedValue(undefined);
    const result = await inTenant(() => ctx.service.runEvent(job()));
    expect(result).toEqual({ skipped: 'alreadySent' });
    expect(ctx.jobs.enqueue).not.toHaveBeenCalled();
    expect(ctx.events.publish).not.toHaveBeenCalled();
  });

  it('group：加入的不是受眾裡的群組 → skipped notInAudience', async () => {
    const ctx = setup({ locked: eventAnnouncement('group.memberAdded') });
    const result = await inTenant(() => ctx.service.runEvent(job({ groupId: 'group-other' })));
    expect(result).toEqual({ skipped: 'notInAudience' });
    expect(ctx.repo.insertDispatch).not.toHaveBeenCalled();
  });

  it('group：事件沒有帶群組 → skipped notInAudience', async () => {
    const ctx = setup({ locked: eventAnnouncement('group.memberAdded') });
    const result = await inTenant(() => ctx.service.runEvent(job({ groupId: undefined })));
    expect(result).toEqual({ skipped: 'notInAudience' });
  });

  it('role：新增的角色有一個在受眾裡就發', async () => {
    const ctx = setup({ locked: eventAnnouncement('user.roleAssigned') });
    const result = await inTenant(() =>
      ctx.service.runEvent(
        job({ event: 'user.roleAssigned', groupId: undefined, roleIds: ['role-x', 'role-1'] }),
      ),
    );
    expect(result).toEqual({ dispatchId: 'disp-new' });
  });

  it('role：新增的角色都不在受眾裡 → skipped notInAudience', async () => {
    const ctx = setup({ locked: eventAnnouncement('user.roleAssigned') });
    const result = await inTenant(() =>
      ctx.service.runEvent(
        job({ event: 'user.roleAssigned', groupId: undefined, roleIds: ['role-x'] }),
      ),
    );
    expect(result).toEqual({ skipped: 'notInAudience' });
  });

  it('audience：以發送當下解析的受眾比對使用者', async () => {
    const ctx = setup({
      locked: eventAnnouncement('user.activated'),
      recipients: ['user-1', 'user-9'],
    });
    const result = await inTenant(() =>
      ctx.service.runEvent(job({ event: 'user.activated', groupId: undefined })),
    );
    expect(ctx.audience.resolve).toHaveBeenCalledWith(AUDIENCE);
    expect(result).toEqual({ dispatchId: 'disp-new' });
  });

  it('audience：使用者不在解析出的受眾裡 → skipped notInAudience', async () => {
    const ctx = setup({ locked: eventAnnouncement('user.activated'), recipients: ['user-1'] });
    const result = await inTenant(() =>
      ctx.service.runEvent(job({ event: 'user.activated', groupId: undefined })),
    );
    expect(result).toEqual({ skipped: 'notInAudience' });
  });

  it.each(['group.memberAdded', 'user.roleAssigned', 'user.activated'])(
    '受眾是全租戶：%s 不論群組或角色都算，不必解析受眾',
    async (event) => {
      const all = { all: true, userIds: [], groupIds: [], roleIds: [] };
      const ctx = setup({ locked: eventAnnouncement(event, all), recipients: [] });
      const result = await inTenant(() =>
        ctx.service.runEvent(job({ event, groupId: 'group-other', roleIds: ['role-x'] })),
      );
      expect(result).toEqual({ dispatchId: 'disp-new' });
      expect(ctx.audience.resolve).not.toHaveBeenCalled();
    },
  );
});

describe('AnnouncementDispatchService.fanOut（docs/architecture/backend/19-announcement.md §5、§9.2 D6、D9、D18）', () => {
  it('租戶停用了公告 → skipped featureDisabled', async () => {
    const ctx = setup();
    const result = await inTenant(
      () => ctx.service.fanOut({ dispatchId: 'disp-1' }),
      [...DISABLED],
    );
    expect(result).toEqual({ skipped: 'featureDisabled' });
    expect(ctx.repo.findDispatch).not.toHaveBeenCalled();
  });

  it('發送紀錄已被清除 → skipped notFound', async () => {
    const ctx = setup({ dispatch: undefined });
    const result = await inTenant(() => ctx.service.fanOut({ dispatchId: 'disp-1' }));
    expect(result).toEqual({ skipped: 'notFound' });
  });

  it.each(['sent', 'failed', 'revoked'] as const)(
    '已經是 %s 的發送直接略過（重做安全）',
    async (status) => {
      const ctx = setup({ dispatch: dispatchRow({ status }) });
      const result = await inTenant(() => ctx.service.fanOut({ dispatchId: 'disp-1' }));
      expect(result).toEqual({ skipped: 'alreadyFinished' });
      expect(ctx.repo.updateDispatch).not.toHaveBeenCalled();
      expect(ctx.notifications.notify).not.toHaveBeenCalled();
    },
  );

  it('開始時改成 sending、記開始時間並發布', async () => {
    const ctx = setup();
    await inTenant(() => ctx.service.fanOut({ dispatchId: 'disp-1' }));
    expect(ctx.repo.updateDispatch).toHaveBeenNthCalledWith(1, 'disp-1', {
      status: 'sending',
      startedAt: NOW,
    });
    expect(ctx.log.slice(0, 2)).toEqual(['updateDispatch', 'publish']);
  });

  it('重做（已是 sending）時保留原本的開始時間', async () => {
    const startedAt = new Date('2026-10-05T01:00:01.000Z');
    const ctx = setup({ dispatch: dispatchRow({ status: 'sending', startedAt }) });
    await inTenant(() => ctx.service.fanOut({ dispatchId: 'disp-1' }));
    expect(ctx.repo.updateDispatch).toHaveBeenNthCalledWith(1, 'disp-1', {
      status: 'sending',
      startedAt,
    });
  });

  it('每位收件人一則通知：觸發者是送出者、參數只有標題、連到全文、source_id 是發送紀錄', async () => {
    const ctx = setup({ recipients: ['user-1'] });
    await inTenant(() => ctx.service.fanOut({ dispatchId: 'disp-1' }));
    expect(ctx.notifications.notify).toHaveBeenCalledWith(
      [
        {
          type: 'announcement.published',
          recipientId: 'user-1',
          actorId: 'actor-1',
          params: { title: '季度說明會' },
          link: { route: 'announcement.message', params: { dispatchId: 'disp-1' } },
          sourceId: 'disp-1',
        },
      ],
      ctx.tx,
    );
  });

  it('每 500 人一個交易，每批都先鎖住發送紀錄', async () => {
    const recipients = Array.from({ length: 1001 }, (_item, index) => `user-${index}`);
    const ctx = setup({ recipients });
    const result = await inTenant(() => ctx.service.fanOut({ dispatchId: 'disp-1' }));
    const sizes = ctx.notifications.notify.mock.calls.map(([input]) =>
      Array.isArray(input) ? input.length : 1,
    );
    expect(sizes).toEqual([500, 500, 1]);
    // 三批＋收尾各一次
    expect(ctx.repo.lockDispatch).toHaveBeenCalledTimes(4);
    expect(result).toEqual({ recipients: 1001, written: 1001, revoked: false });
  });

  it('完成：sent、實際寫入的人數（含重做前寫的）、略過的來源、結束時間', async () => {
    const ctx = setup();
    ctx.notifications.statsBySources.mockResolvedValue(
      new Map([['disp-1', { total: 7, read: 0 }]]),
    );
    await inTenant(() => ctx.service.fanOut({ dispatchId: 'disp-1' }));
    expect(ctx.repo.updateDispatch).toHaveBeenLastCalledWith(
      'disp-1',
      { status: 'sent', recipientCount: 7, details: { skipped: NO_SKIPPED }, finishedAt: NOW },
      ctx.tx,
    );
  });

  it('受眾解析不出任何人：沒有寫入，照樣以 0 人完成', async () => {
    const ctx = setup({ recipients: [] });
    ctx.notifications.statsBySources.mockResolvedValue(new Map());
    const result = await inTenant(() => ctx.service.fanOut({ dispatchId: 'disp-1' }));
    expect(result).toEqual({ recipients: 0, written: 0, revoked: false });
    expect(ctx.notifications.notify).not.toHaveBeenCalled();
    expect(ctx.repo.updateDispatch).toHaveBeenLastCalledWith(
      'disp-1',
      expect.objectContaining({ status: 'sent', recipientCount: 0 }),
      ctx.tx,
    );
  });

  it('收件人超過上限：那次發送 failed（不截斷），details 記原因與人數，不寫任何通知', async () => {
    const ctx = setup({
      recipients: ['user-1', 'user-2', 'user-3'],
      settings: { maxRecipients: 2 },
    });
    ctx.notifications.statsBySources.mockResolvedValue(new Map());
    const result = await inTenant(() => ctx.service.fanOut({ dispatchId: 'disp-1' }));
    expect(result).toEqual({ failed: 'tooManyRecipients', count: 3, max: 2 });
    expect(ctx.notifications.notify).not.toHaveBeenCalled();
    expect(ctx.repo.updateDispatch).toHaveBeenLastCalledWith(
      'disp-1',
      {
        status: 'failed',
        recipientCount: 0,
        details: { reason: 'tooManyRecipients', count: 3, max: 2, skipped: NO_SKIPPED },
        finishedAt: NOW,
      },
      ctx.tx,
    );
  });

  it('收件人剛好等於上限照常發送', async () => {
    const ctx = setup({ recipients: ['user-1', 'user-2'], settings: { maxRecipients: 2 } });
    const result = await inTenant(() => ctx.service.fanOut({ dispatchId: 'disp-1' }));
    expect(result).toEqual({ recipients: 2, written: 2, revoked: false });
  });

  it('中途被撤回：下一批看到 revoked 就停，不再寫入也不覆蓋成 sent', async () => {
    const recipients = Array.from({ length: 600 }, (_item, index) => `user-${index}`);
    const ctx = setup({ recipients });
    ctx.repo.lockDispatch
      .mockResolvedValueOnce(dispatchRow({ status: 'sending' }))
      .mockResolvedValue(dispatchRow({ status: 'revoked' }));
    const result = await inTenant(() => ctx.service.fanOut({ dispatchId: 'disp-1' }));
    expect(result).toEqual({ recipients: 600, written: 500, revoked: true });
    expect(ctx.notifications.notify).toHaveBeenCalledTimes(1);
    // 只有開始時的 sending，沒有收尾
    expect(ctx.repo.updateDispatch).toHaveBeenCalledTimes(1);
  });

  it('最後一批之後、收尾之前被撤回：收尾不覆蓋 revoked', async () => {
    const ctx = setup();
    ctx.repo.lockDispatch
      .mockResolvedValueOnce(dispatchRow({ status: 'sending' }))
      .mockResolvedValue(dispatchRow({ status: 'revoked' }));
    const result = await inTenant(() => ctx.service.fanOut({ dispatchId: 'disp-1' }));
    expect(result).toEqual({ recipients: 2, written: 2, revoked: false });
    expect(ctx.repo.updateDispatch).toHaveBeenCalledTimes(1);
  });
});

const scheduledRow = (overrides: Partial<AnnouncementRow>) =>
  announcement({ status: 'scheduled', ...overrides });

function withScheduled(ctx: ReturnType<typeof setup>, rows: AnnouncementRow[]) {
  ctx.repo.listScheduled.mockResolvedValue(
    rows.map(({ id, trigger, nextRunAt }) => ({ id, trigger, nextRunAt })),
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  ctx.repo.lockActive.mockImplementation(async (id: string) => byId.get(id));
}

describe('AnnouncementDispatchService.maintain（docs/architecture/backend/19-announcement.md §5.2、§9.2 D10、D19）', () => {
  it('租戶停用了公告 → skipped featureDisabled，不清理也不補排程', async () => {
    const ctx = setup();
    const result = await inTenant(() => ctx.service.maintain(NOW), [...DISABLED]);
    expect(result).toEqual({ skipped: 'featureDisabled' });
    expect(ctx.repo.listScheduled).not.toHaveBeenCalled();
    expect(ctx.repo.deleteFinishedDispatchesBefore).not.toHaveBeenCalled();
  });

  it('週期在改了租戶時區後重算：更新 next_run_at、入列、發布', async () => {
    // 存的是台北 09:00（01:00Z）；時區改成 UTC 後應是 09:00Z
    const ctx = setup({ settings: { timeZone: 'UTC' } });
    withScheduled(ctx, [
      scheduledRow({ trigger: DAILY_NINE, nextRunAt: new Date('2026-10-06T01:00:00.000Z') }),
    ]);
    const result = await inTenant(() => ctx.service.maintain(NOW));
    const expected = new Date('2026-10-06T09:00:00.000Z');
    expect(ctx.repo.setState).toHaveBeenCalledWith(
      'ann-1',
      { status: 'scheduled', nextRunAt: expected },
      ctx.tx,
    );
    expect(ctx.jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'announcement.dispatch' }),
      { announcementId: 'ann-1', runAt: expected.toISOString() },
      { tx: ctx.tx, startAfter: expected },
    );
    expect(ctx.events.publish).toHaveBeenCalledWith(...changed());
    expect(result).toMatchObject({ rescheduled: 1, requeued: 1, completed: 0 });
  });

  it('週期的延遲工作遺失（存的時間已經過了）：照存的時間再入列一筆，不改 next_run_at', async () => {
    const stored = new Date('2026-10-05T01:00:00.000Z');
    const ctx = setup();
    withScheduled(ctx, [scheduledRow({ trigger: DAILY_NINE, nextRunAt: stored })]);
    const result = await inTenant(() => ctx.service.maintain(NOW));
    expect(ctx.repo.setState).not.toHaveBeenCalled();
    expect(ctx.jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'announcement.dispatch' }),
      { announcementId: 'ann-1', runAt: stored.toISOString() },
      { tx: ctx.tx, startAfter: stored },
    );
    expect(result).toMatchObject({ rescheduled: 0, requeued: 1 });
    expect(ctx.events.publish).not.toHaveBeenCalled();
  });

  it('指定時間在 25 小時內：再入列一筆（重複的工作執行時會略過）', async () => {
    const at = '2026-10-06T20:00:00.000Z';
    const ctx = setup();
    withScheduled(ctx, [scheduledRow({ trigger: { kind: 'once', at }, nextRunAt: new Date(at) })]);
    const result = await inTenant(() => ctx.service.maintain(NOW));
    expect(ctx.jobs.enqueue).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ rescheduled: 0, requeued: 1 });
  });

  it('指定時間已經過了（延遲工作遺失）：照存的時間補入列，不當成過期', async () => {
    const at = '2026-10-04T00:00:00.000Z';
    const ctx = setup();
    withScheduled(ctx, [scheduledRow({ trigger: { kind: 'once', at }, nextRunAt: new Date(at) })]);
    await inTenant(() => ctx.service.maintain(NOW));
    expect(ctx.repo.setState).not.toHaveBeenCalled();
    expect(ctx.jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'announcement.dispatch' }),
      { announcementId: 'ann-1', runAt: at },
      { tx: ctx.tx, startAfter: new Date(at) },
    );
  });

  it('下一次在 25 小時之後：不重複入列', async () => {
    const at = '2026-10-20T00:00:00.000Z';
    const ctx = setup();
    withScheduled(ctx, [scheduledRow({ trigger: { kind: 'once', at }, nextRunAt: new Date(at) })]);
    const result = await inTenant(() => ctx.service.maintain(NOW));
    expect(ctx.jobs.enqueue).not.toHaveBeenCalled();
    expect(result).toMatchObject({ rescheduled: 0, requeued: 0 });
  });

  it('週期的次數已用完：改成 completed、發布，不入列也不計入 requeued', async () => {
    const ctx = setup({ dispatchCount: 2 });
    withScheduled(ctx, [
      scheduledRow({
        trigger: { ...DAILY_NINE, maxOccurrences: 2 },
        nextRunAt: new Date('2026-10-06T01:00:00.000Z'),
      }),
    ]);
    const result = await inTenant(() => ctx.service.maintain(NOW));
    expect(ctx.repo.setState).toHaveBeenCalledWith(
      'ann-1',
      { status: 'completed', nextRunAt: null },
      ctx.tx,
    );
    expect(ctx.jobs.enqueue).not.toHaveBeenCalled();
    expect(ctx.events.publish).toHaveBeenCalledWith(...changed());
    expect(result).toMatchObject({ rescheduled: 0, requeued: 0, completed: 1 });
  });

  it('事件點的公告沒有時間表：不碰', async () => {
    const ctx = setup();
    withScheduled(ctx, [
      scheduledRow({ trigger: { kind: 'event', event: 'user.activated', delayMinutes: 0 } }),
    ]);
    const result = await inTenant(() => ctx.service.maintain(NOW));
    expect(ctx.repo.setState).not.toHaveBeenCalled();
    expect(ctx.jobs.enqueue).not.toHaveBeenCalled();
    expect(result).toMatchObject({ rescheduled: 0, requeued: 0 });
  });

  it('列出之後被暫停或刪除的公告：不碰', async () => {
    const ctx = setup();
    ctx.repo.listScheduled.mockResolvedValue([
      { id: 'ann-1', trigger: DAILY_NINE, nextRunAt: new Date('2026-10-06T01:00:00.000Z') },
      { id: 'ann-2', trigger: DAILY_NINE, nextRunAt: new Date('2026-10-06T01:00:00.000Z') },
    ]);
    ctx.repo.lockActive
      .mockResolvedValueOnce(announcement({ status: 'paused', trigger: DAILY_NINE }))
      .mockResolvedValueOnce(undefined);
    await inTenant(() => ctx.service.maintain(NOW));
    expect(ctx.repo.setState).not.toHaveBeenCalled();
    expect(ctx.jobs.enqueue).not.toHaveBeenCalled();
  });

  it('保留清理：刪除建立超過保留天數、已結束的發送紀錄，每批 500 筆直到不滿一批', async () => {
    const ctx = setup({ settings: { retentionDays: 30 } });
    ctx.repo.deleteFinishedDispatchesBefore
      .mockResolvedValueOnce(500)
      .mockResolvedValueOnce(500)
      .mockResolvedValueOnce(3);
    const result = await inTenant(() => ctx.service.maintain(NOW));
    const cutoff = new Date('2026-09-06T00:00:00.000Z');
    expect(ctx.repo.deleteFinishedDispatchesBefore).toHaveBeenCalledTimes(3);
    expect(ctx.repo.deleteFinishedDispatchesBefore).toHaveBeenCalledWith(cutoff, 500);
    expect(result).toEqual({
      rescheduled: 0,
      requeued: 0,
      completed: 0,
      retentionDays: 30,
      deletedDispatches: 1003,
    });
  });
});
