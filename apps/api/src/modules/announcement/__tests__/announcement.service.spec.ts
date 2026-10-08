import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { plainTextToRichText } from '@b2b-system/rich-text';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PERMISSION } from '@/common/types';
import type { PermissionKey } from '@/common/types';
import type { PermissionSet } from '@/core/cache';
import type { Database } from '@/core/database';
import { DomainEvent } from '@/core/events';
import type { DomainEventBus } from '@/core/events';
import type { JobQueue } from '@/core/jobs';
import type { TenantFeature } from '@/core/tenant';
import type {
  AnnouncementDispatchRow,
  AnnouncementRow,
  AnnouncementTriggerValue,
} from '@/db/schema';
import type { AuditService } from '@/modules/audit-log/audit.service';
import type { NotificationService } from '@/modules/notification/notification.service';
import { createPermissionChecks } from '@/modules/permission/__tests__/permission-checks.fixture';

import type { AnnouncementAudienceResolver, ResolvedAudience } from '../announcement.audience';
import type {
  AnnouncementWithPeople,
  AnnouncementRepository,
  DispatchWithPeople,
} from '../announcement.repository';
import { AnnouncementService } from '../announcement.service';
import {
  ACTOR,
  announcement,
  catalog,
  dispatchRow,
  dispatchWithPeople,
  expectCode,
  fakeDatabase,
  fakeJobs,
  fakeSettings,
  inTenant,
  NOW,
  PERSON,
  scheduler,
  TAIPEI,
  withPeople,
} from './announcement.fixture';

const FUTURE = '2026-10-10T01:00:00.000Z';
const PAST = '2026-10-01T01:00:00.000Z';
const NO_PERMISSIONS: PermissionSet = { permissions: new Set(), isSuperAdmin: false };
const PUBLISHER: PermissionSet = {
  permissions: new Set<PermissionKey>([PERMISSION.ANNOUNCEMENT_PUBLISH]),
  isSuperAdmin: false,
};

interface SetupOptions {
  stored?: AnnouncementRow;
  permissionSet?: PermissionSet;
  dispatchCount?: number;
}

function setup(options: SetupOptions = {}) {
  const log: string[] = [];
  const { db, tx } = fakeDatabase(log);
  let stored = options.stored ?? announcement();
  const repo = {
    list: vi.fn(async (): Promise<{ items: AnnouncementWithPeople[]; total: number }> => ({
      items: [],
      total: 0,
    })),
    findActive: vi.fn(async (): Promise<AnnouncementRow | undefined> => stored),
    findWithPeople: vi.fn(async (): Promise<AnnouncementWithPeople | undefined> =>
      withPeople(stored),
    ),
    latestDispatches: vi.fn(
      async (_ids: readonly string[]): Promise<AnnouncementDispatchRow[]> => [],
    ),
    create: vi.fn(async (values: Partial<AnnouncementRow>) => {
      stored = announcement({ ...values, id: 'ann-new', version: 1 });
      return stored;
    }),
    update: vi.fn(
      async (
        _id: string,
        values: Partial<AnnouncementRow>,
        _version: number,
        _tx: unknown,
      ): Promise<AnnouncementRow | undefined> => {
        stored = { ...stored, ...values, version: stored.version + 1 };
        return stored;
      },
    ),
    findVersion: vi.fn(async (): Promise<number | undefined> => stored.version + 1),
    countDispatches: vi.fn(async () => options.dispatchCount ?? 0),
    insertDispatch: vi.fn(
      async (
        values: Partial<AnnouncementDispatchRow>,
      ): Promise<AnnouncementDispatchRow | undefined> => dispatchRow({ ...values, id: 'disp-new' }),
    ),
    lockActive: vi.fn(async (): Promise<AnnouncementRow | undefined> => stored),
    softDelete: vi.fn(async () => {
      log.push('softDelete');
    }),
    findDeletedById: vi.fn(async (): Promise<AnnouncementRow | undefined> => undefined),
    exists: vi.fn(async () => true),
    restore: vi.fn(async (): Promise<AnnouncementRow | undefined> => stored),
    listDispatches: vi.fn(async (): Promise<{ items: DispatchWithPeople[]; total: number }> => ({
      items: [],
      total: 0,
    })),
    lockDispatch: vi.fn(async (): Promise<AnnouncementDispatchRow | undefined> =>
      dispatchRow({ status: 'sent', recipientCount: 12 }),
    ),
    updateDispatch: vi.fn(async () => undefined),
    findDispatchWithPeople: vi.fn(async (): Promise<DispatchWithPeople | undefined> =>
      dispatchWithPeople({ status: 'revoked' }),
    ),
  };
  const audience = {
    resolve: vi.fn(async (): Promise<ResolvedAudience> => ({
      userIds: ['user-1', 'user-2'],
      skipped: { userIds: [], groupIds: ['group-gone'], roleIds: [] },
    })),
  };
  const notifications = {
    statsBySources: vi.fn(
      async (_ids: readonly string[]) => new Map<string, { total: number; read: number }>(),
    ),
    removeBySource: vi.fn(async () => {
      log.push('removeBySource');
      return 12;
    }),
    markSourceRead: vi.fn(async () => true),
  };
  // 真的權限判斷（拒絕時寫 authz.denied）；getPermissionSet 回傳這個案例的集合
  const { service: permissions, audit: denials } = createPermissionChecks(
    () => options.permissionSet ?? PUBLISHER,
  );
  const audit = {
    record: vi.fn(async (_entry: object, _tx: unknown) => {
      log.push('audit');
    }),
  };
  const jobs = fakeJobs(log);
  const settings = fakeSettings();
  const events = {
    publish: vi.fn(() => {
      log.push('publish');
    }),
  };
  const service = new AnnouncementService(
    db as unknown as Database,
    repo as unknown as AnnouncementRepository,
    audience as unknown as AnnouncementAudienceResolver,
    notifications as unknown as NotificationService,
    permissions,
    audit as unknown as AuditService,
    jobs as unknown as JobQueue,
    scheduler(settings, jobs),
    catalog(),
    events as unknown as DomainEventBus,
  );
  return {
    service,
    repo,
    audience,
    notifications,
    permissions,
    denials,
    audit,
    jobs,
    events,
    tx,
    log,
  };
}

function changed(kind: ChangeKind, id = 'ann-1') {
  return [
    DomainEvent.RESOURCE_CHANGED,
    { changes: [{ resource: ChangeSource.ANNOUNCEMENT, kind, id }] },
  ];
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

const run = <T>(fn: () => Promise<T>, features?: TenantFeature[]) => inTenant(fn, features);

describe('AnnouncementService.list／findOne（docs/architecture/backend/19-announcement.md §3）', () => {
  it('列表每則帶最近一次發送與它的已讀數；沒發過的 lastDispatch 為 null', async () => {
    const ctx = setup();
    ctx.repo.list.mockResolvedValue({
      items: [withPeople(announcement()), withPeople(announcement({ id: 'ann-2' }))],
      total: 7,
    });
    ctx.repo.latestDispatches.mockResolvedValue([dispatchRow({ recipientCount: 10 })]);
    ctx.notifications.statsBySources.mockResolvedValue(
      new Map([['disp-1', { total: 10, read: 4 }]]),
    );

    const result = await run(() => ctx.service.list({ offset: 0, limit: 20 }));

    expect(ctx.repo.latestDispatches).toHaveBeenCalledWith(['ann-1', 'ann-2']);
    expect(ctx.notifications.statsBySources).toHaveBeenCalledWith(['disp-1']);
    expect(result.pagination).toEqual({ offset: 0, limit: 20, total: 7 });
    expect(result.items[0]?.lastDispatch).toEqual({
      id: 'disp-1',
      status: 'pending',
      scheduledFor: '2026-10-05T01:00:00.000Z',
      recipientCount: 10,
      readCount: 4,
    });
    expect(result.items[1]?.lastDispatch).toBeNull();
  });

  it('單筆以 ISO 字串回傳時間，並帶建立者與最後修改者', async () => {
    const ctx = setup({
      stored: announcement({
        status: 'scheduled',
        nextRunAt: new Date(FUTURE),
        trigger: { kind: 'once', at: FUTURE },
      }),
    });
    const dto = await run(() => ctx.service.findOne('ann-1'));
    expect(dto).toMatchObject({
      id: 'ann-1',
      status: 'scheduled',
      nextRunAt: FUTURE,
      lastDispatch: null,
      createdAt: '2026-10-01T00:00:00.000Z',
      createdBy: PERSON,
      updatedBy: PERSON,
    });
    expect(ctx.notifications.statsBySources).toHaveBeenCalledWith([]);
  });

  it('不存在或已刪除 → 404 ANNOUNCEMENT_NOT_FOUND', async () => {
    const ctx = setup();
    ctx.repo.findWithPeople.mockResolvedValue(undefined);
    await expectCode(
      run(() => ctx.service.findOne('missing')),
      'ANNOUNCEMENT_NOT_FOUND',
    );
  });
});

describe('AnnouncementService.create（docs/architecture/backend/19-announcement.md §3）', () => {
  const dto = {
    title: '季度說明會',
    body: plainTextToRichText('內文'),
    audience: { all: false, userIds: [], groupIds: [], roleIds: [] },
    trigger: { kind: 'immediate' } as AnnouncementTriggerValue,
  };

  it('建立草稿：狀態 draft，建立者與修改者都是操作者；受眾可以空著', async () => {
    const ctx = setup();
    const result = await run(() => ctx.service.create(dto, ACTOR));
    expect(ctx.repo.create).toHaveBeenCalledWith(
      {
        title: dto.title,
        // 文件存 body_doc，純文字存 body（搜尋、字數、稽核）
        body: '內文',
        bodyDoc: dto.body,
        audience: dto.audience,
        trigger: dto.trigger,
        status: 'draft',
        createdBy: ACTOR.id,
        updatedBy: ACTOR.id,
      },
      ctx.tx,
    );
    expect(result.id).toBe('ann-new');
  });

  it('稽核在同一個交易內，內文只記長度', async () => {
    const ctx = setup();
    await run(() => ctx.service.create(dto, ACTOR));
    expect(ctx.audit.record).toHaveBeenCalledWith(
      {
        action: 'announcement.create',
        resourceType: 'announcement',
        resourceId: 'ann-new',
        resourceName: '季度說明會',
        changes: {
          after: {
            title: '季度說明會',
            bodyLength: 2,
            audience: dto.audience,
            trigger: dto.trigger,
          },
        },
      },
      ctx.tx,
    );
  });

  it('交易提交之後才發布 create 的資源變更', async () => {
    const ctx = setup();
    await run(() => ctx.service.create(dto, ACTOR));
    expect(ctx.log).toEqual(['begin', 'audit', 'commit', 'publish']);
    expect(ctx.events.publish).toHaveBeenCalledWith(...changed(ChangeKind.CREATE, 'ann-new'));
  });

  it('事件點不在觸發點目錄上 → 400 ANNOUNCEMENT_EVENT_UNKNOWN，不寫入', async () => {
    const ctx = setup();
    const trigger = { kind: 'event', event: 'order.shipped', delayMinutes: 0 } as const;
    await expectCode(
      run(() => ctx.service.create({ ...dto, trigger }, ACTOR)),
      'ANNOUNCEMENT_EVENT_UNKNOWN',
      { event: 'order.shipped' },
    );
    expect(ctx.repo.create).not.toHaveBeenCalled();
  });

  it('事件點所屬的 feature 沒啟用 → 400 ANNOUNCEMENT_EVENT_UNKNOWN', async () => {
    const ctx = setup();
    const trigger = { kind: 'event', event: 'file.uploaded', delayMinutes: 0 } as const;
    await expectCode(
      run(() => ctx.service.create({ ...dto, trigger }, ACTOR), ['announcement']),
      'ANNOUNCEMENT_EVENT_UNKNOWN',
    );
  });

  it('目錄上、feature 已啟用的事件點可以建立', async () => {
    const ctx = setup();
    const trigger = { kind: 'event', event: 'file.uploaded', delayMinutes: 30 } as const;
    await run(() => ctx.service.create({ ...dto, trigger }, ACTOR));
    expect(ctx.repo.create).toHaveBeenCalledWith(expect.objectContaining({ trigger }), ctx.tx);
  });
});

const scheduledOnce = () =>
  announcement({
    status: 'scheduled',
    trigger: { kind: 'once', at: FUTURE },
    nextRunAt: new Date(FUTURE),
  });

describe('AnnouncementService.update（docs/architecture/backend/19-announcement.md §3、§9.2 D15）', () => {
  it('不存在 → 404 ANNOUNCEMENT_NOT_FOUND', async () => {
    const ctx = setup();
    ctx.repo.findActive.mockResolvedValue(undefined);
    await expectCode(
      run(() => ctx.service.update('missing', { version: 3, title: '新' }, ACTOR)),
      'ANNOUNCEMENT_NOT_FOUND',
    );
  });

  it('version 過時 → 409 ANNOUNCEMENT_VERSION_CONFLICT（details.current），不寫入', async () => {
    const ctx = setup();
    await expectCode(
      run(() => ctx.service.update('ann-1', { version: 2, title: '新' }, ACTOR)),
      'ANNOUNCEMENT_VERSION_CONFLICT',
      { current: 3 },
    );
    expect(ctx.repo.update).not.toHaveBeenCalled();
  });

  it('已完成的不能改 → 409 ANNOUNCEMENT_INVALID_STATE', async () => {
    const ctx = setup({ stored: announcement({ status: 'completed' }) });
    await expectCode(
      run(() => ctx.service.update('ann-1', { version: 3, title: '新' }, ACTOR)),
      'ANNOUNCEMENT_INVALID_STATE',
      { status: 'completed' },
    );
  });

  it('草稿只要路由上的 announcement:update：不查 announcement:publish', async () => {
    const ctx = setup({ permissionSet: NO_PERMISSIONS });
    await run(() => ctx.service.update('ann-1', { version: 3, title: '新標題' }, ACTOR));
    expect(ctx.permissions.getPermissionSet).not.toHaveBeenCalled();
    expect(ctx.repo.update).toHaveBeenCalledWith(
      'ann-1',
      { title: '新標題', updatedBy: ACTOR.id },
      3,
      ctx.tx,
    );
  });

  it.each(['scheduled', 'paused'] as const)(
    '%s 的公告沒有 announcement:publish → 403 AUTHZ_FORBIDDEN（details.required、missing），寫 authz.denied',
    async (status) => {
      const ctx = setup({
        stored: announcement({ ...scheduledOnce(), status }),
        permissionSet: NO_PERMISSIONS,
      });
      await expectCode(
        run(() => ctx.service.update('ann-1', { version: 3, title: '新' }, ACTOR)),
        'AUTHZ_FORBIDDEN',
        {
          required: [PERMISSION.ANNOUNCEMENT_PUBLISH],
          missing: [PERMISSION.ANNOUNCEMENT_PUBLISH],
        },
      );
      // 不在交易內判斷：沒有帶 tx
      expect(ctx.permissions.getPermissionSet).toHaveBeenCalledWith(ACTOR.id, undefined);
      expect(ctx.denials.recordSafely).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'authz.denied',
          actorId: ACTOR.id,
          metadata: {
            announcementId: 'ann-1',
            route: 'PATCH /announcements/:id',
            required: [PERMISSION.ANNOUNCEMENT_PUBLISH],
            missing: [PERMISSION.ANNOUNCEMENT_PUBLISH],
          },
        }),
      );
      expect(ctx.repo.update).not.toHaveBeenCalled();
    },
  );

  it('超級管理員不必另有 announcement:publish 就能改排程中的公告', async () => {
    const ctx = setup({
      stored: scheduledOnce(),
      permissionSet: { permissions: new Set(), isSuperAdmin: true },
    });
    await run(() => ctx.service.update('ann-1', { version: 3, title: '新' }, ACTOR));
    expect(ctx.repo.update).toHaveBeenCalled();
  });

  it('排程中的公告不能改成「立即」→ 409 ANNOUNCEMENT_INVALID_STATE', async () => {
    const ctx = setup({ stored: scheduledOnce() });
    await expectCode(
      run(() => ctx.service.update('ann-1', { version: 3, trigger: { kind: 'immediate' } }, ACTOR)),
      'ANNOUNCEMENT_INVALID_STATE',
      { status: 'scheduled' },
    );
  });

  it('改成不在目錄上的事件點 → 400 ANNOUNCEMENT_EVENT_UNKNOWN', async () => {
    const ctx = setup();
    await expectCode(
      run(() =>
        ctx.service.update(
          'ann-1',
          { version: 3, trigger: { kind: 'event', event: 'order.shipped', delayMinutes: 0 } },
          ACTOR,
        ),
      ),
      'ANNOUNCEMENT_EVENT_UNKNOWN',
    );
  });

  it('排程中改了時間：重算 next_run_at，在同一個交易內入列新的延遲工作', async () => {
    const ctx = setup({ stored: scheduledOnce() });
    const at = '2026-10-20T03:00:00.000Z';
    await run(() =>
      ctx.service.update('ann-1', { version: 3, trigger: { kind: 'once', at } }, ACTOR),
    );
    expect(ctx.repo.update).toHaveBeenCalledWith(
      'ann-1',
      { trigger: { kind: 'once', at }, nextRunAt: new Date(at), updatedBy: ACTOR.id },
      3,
      ctx.tx,
    );
    expect(ctx.jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'announcement.dispatch' }),
      { announcementId: 'ann-1', runAt: at },
      { tx: ctx.tx, startAfter: new Date(at) },
    );
    expect(ctx.log).toEqual([
      'begin',
      'enqueue:announcement.dispatch',
      'audit',
      'commit',
      'publish',
    ]);
  });

  it('排程中改成已經過去的時間 → 400 ANNOUNCEMENT_TRIGGER_IN_PAST，不寫入', async () => {
    const ctx = setup({ stored: scheduledOnce() });
    await expectCode(
      run(() =>
        ctx.service.update('ann-1', { version: 3, trigger: { kind: 'once', at: PAST } }, ACTOR),
      ),
      'ANNOUNCEMENT_TRIGGER_IN_PAST',
      { at: PAST },
    );
    expect(ctx.repo.update).not.toHaveBeenCalled();
  });

  it('排程中改週期：次數上限以已建立的發送紀錄計，用完 → 400 ANNOUNCEMENT_TRIGGER_IN_PAST', async () => {
    const ctx = setup({ stored: scheduledOnce(), dispatchCount: 2 });
    const trigger = {
      kind: 'recurring',
      frequency: 'daily',
      interval: 1,
      time: '09:00',
      startsOn: '2026-10-01',
      maxOccurrences: 2,
    } as const;
    await expectCode(
      run(() => ctx.service.update('ann-1', { version: 3, trigger }, ACTOR)),
      'ANNOUNCEMENT_TRIGGER_IN_PAST',
      { reason: 'noOccurrence' },
    );
    expect(ctx.repo.countDispatches).toHaveBeenCalledWith('ann-1');
  });

  it('排程中改成事件點：next_run_at 清空，不入列延遲工作', async () => {
    const ctx = setup({ stored: scheduledOnce() });
    const trigger = { kind: 'event', event: 'user.activated', delayMinutes: 0 } as const;
    await run(() => ctx.service.update('ann-1', { version: 3, trigger }, ACTOR));
    expect(ctx.repo.update).toHaveBeenCalledWith(
      'ann-1',
      { trigger, nextRunAt: null, updatedBy: ACTOR.id },
      3,
      ctx.tx,
    );
    expect(ctx.jobs.enqueue).not.toHaveBeenCalled();
  });

  it('排程中只改標題：不重算時間、不入列', async () => {
    const ctx = setup({ stored: scheduledOnce() });
    await run(() => ctx.service.update('ann-1', { version: 3, title: '新' }, ACTOR));
    expect(ctx.repo.update).toHaveBeenCalledWith(
      'ann-1',
      { title: '新', updatedBy: ACTOR.id },
      3,
      ctx.tx,
    );
    expect(ctx.jobs.enqueue).not.toHaveBeenCalled();
  });

  it('暫停中改時間：只存新的觸發方式，不算下一次也不入列（恢復時才算）', async () => {
    const ctx = setup({ stored: { ...scheduledOnce(), status: 'paused', nextRunAt: null } });
    const at = '2026-10-20T03:00:00.000Z';
    await run(() =>
      ctx.service.update('ann-1', { version: 3, trigger: { kind: 'once', at } }, ACTOR),
    );
    expect(ctx.repo.update).toHaveBeenCalledWith(
      'ann-1',
      { trigger: { kind: 'once', at }, updatedBy: ACTOR.id },
      3,
      ctx.tx,
    );
    expect(ctx.jobs.enqueue).not.toHaveBeenCalled();
  });

  it('稽核記前後的快照與更新後的狀態', async () => {
    const ctx = setup({ stored: scheduledOnce() });
    await run(() =>
      ctx.service.update('ann-1', { version: 3, body: plainTextToRichText('改過的內文') }, ACTOR),
    );
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'announcement.update',
        resourceId: 'ann-1',
        changes: {
          before: expect.objectContaining({ bodyLength: 15 }),
          after: expect.objectContaining({ bodyLength: 5 }),
        },
        metadata: { status: 'scheduled' },
      }),
      ctx.tx,
    );
    expect(ctx.events.publish).toHaveBeenCalledWith(...changed(ChangeKind.UPDATE));
  });

  it('寫入時 version 已被別人改掉 → 409 ANNOUNCEMENT_VERSION_CONFLICT（帶最新的 version），不發布', async () => {
    const ctx = setup();
    ctx.repo.update.mockResolvedValue(undefined);
    ctx.repo.findVersion.mockResolvedValue(4);
    await expectCode(
      run(() => ctx.service.update('ann-1', { version: 3, title: '新' }, ACTOR)),
      'ANNOUNCEMENT_VERSION_CONFLICT',
      { current: 4 },
    );
    expect(ctx.audit.record).not.toHaveBeenCalled();
    expect(ctx.events.publish).not.toHaveBeenCalled();
  });

  it('寫入時已被刪除 → 404 ANNOUNCEMENT_NOT_FOUND', async () => {
    const ctx = setup();
    ctx.repo.update.mockResolvedValue(undefined);
    ctx.repo.findVersion.mockResolvedValue(undefined);
    await expectCode(
      run(() => ctx.service.update('ann-1', { version: 3, title: '新' }, ACTOR)),
      'ANNOUNCEMENT_NOT_FOUND',
    );
  });
});

describe('AnnouncementService.publishAnnouncement（docs/architecture/backend/19-announcement.md §3、§9.2 D8）', () => {
  it('version 過時 → 409 ANNOUNCEMENT_VERSION_CONFLICT', async () => {
    const ctx = setup();
    await expectCode(
      run(() => ctx.service.publishAnnouncement('ann-1', { version: 1 }, ACTOR)),
      'ANNOUNCEMENT_VERSION_CONFLICT',
      { current: 3 },
    );
  });

  it.each(['scheduled', 'paused', 'completed'] as const)(
    '只限草稿：%s → 409 ANNOUNCEMENT_INVALID_STATE',
    async (status) => {
      const ctx = setup({ stored: announcement({ status }) });
      await expectCode(
        run(() => ctx.service.publishAnnouncement('ann-1', { version: 3 }, ACTOR)),
        'ANNOUNCEMENT_INVALID_STATE',
        { status },
      );
    },
  );

  it('受眾是空的 → 400 ANNOUNCEMENT_AUDIENCE_EMPTY', async () => {
    const ctx = setup({
      stored: announcement({ audience: { all: false, userIds: [], groupIds: [], roleIds: [] } }),
    });
    await expectCode(
      run(() => ctx.service.publishAnnouncement('ann-1', { version: 3 }, ACTOR)),
      'ANNOUNCEMENT_AUDIENCE_EMPTY',
    );
    expect(ctx.repo.update).not.toHaveBeenCalled();
  });

  it('事件點的 feature 在建立後被停用 → 400 ANNOUNCEMENT_EVENT_UNKNOWN', async () => {
    const ctx = setup({
      stored: announcement({ trigger: { kind: 'event', event: 'file.uploaded', delayMinutes: 0 } }),
    });
    await expectCode(
      run(() => ctx.service.publishAnnouncement('ann-1', { version: 3 }, ACTOR), ['announcement']),
      'ANNOUNCEMENT_EVENT_UNKNOWN',
    );
  });

  it('立即：狀態 completed，在同一個交易建立發送（內容快照、送出者）並入列分批寫入', async () => {
    const ctx = setup();
    await run(() => ctx.service.publishAnnouncement('ann-1', { version: 3 }, ACTOR));
    expect(ctx.repo.update).toHaveBeenCalledWith(
      'ann-1',
      { status: 'completed', nextRunAt: null, updatedBy: ACTOR.id },
      3,
      ctx.tx,
    );
    expect(ctx.repo.insertDispatch).toHaveBeenCalledWith(
      {
        announcementId: 'ann-1',
        scheduledFor: NOW,
        title: '季度說明會',
        body: '十月的季度說明會改到線上舉行。',
        bodyDoc: plainTextToRichText('十月的季度說明會改到線上舉行。'),
        audience: announcement().audience,
        createdBy: ACTOR.id,
      },
      ctx.tx,
    );
    expect(ctx.jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'announcement.fanOut' }),
      { dispatchId: 'disp-new' },
      { tx: ctx.tx },
    );
  });

  it('立即：稽核帶觸發方式與發送紀錄的 id，提交後才發布', async () => {
    const ctx = setup();
    await run(() => ctx.service.publishAnnouncement('ann-1', { version: 3 }, ACTOR));
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'announcement.publish',
        metadata: { trigger: { kind: 'immediate' }, dispatchId: 'disp-new' },
      }),
      ctx.tx,
    );
    expect(ctx.log).toEqual(['begin', 'enqueue:announcement.fanOut', 'audit', 'commit', 'publish']);
  });

  it('立即：沒有建立發送紀錄就整個交易失敗，不發布', async () => {
    const ctx = setup();
    ctx.repo.insertDispatch.mockResolvedValue(undefined);
    await expect(
      run(() => ctx.service.publishAnnouncement('ann-1', { version: 3 }, ACTOR)),
    ).rejects.toThrow();
    expect(ctx.jobs.enqueue).not.toHaveBeenCalled();
    expect(ctx.events.publish).not.toHaveBeenCalled();
  });

  it('指定時間：scheduled，next_run_at 是那個時間，交易內入列延遲工作；不建立發送', async () => {
    const ctx = setup({ stored: announcement({ trigger: { kind: 'once', at: FUTURE } }) });
    await run(() => ctx.service.publishAnnouncement('ann-1', { version: 3 }, ACTOR));
    expect(ctx.repo.update).toHaveBeenCalledWith(
      'ann-1',
      { status: 'scheduled', nextRunAt: new Date(FUTURE), updatedBy: ACTOR.id },
      3,
      ctx.tx,
    );
    expect(ctx.jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'announcement.dispatch' }),
      { announcementId: 'ann-1', runAt: FUTURE },
      { tx: ctx.tx, startAfter: new Date(FUTURE) },
    );
    expect(ctx.repo.insertDispatch).not.toHaveBeenCalled();
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { trigger: { kind: 'once', at: FUTURE } } }),
      ctx.tx,
    );
  });

  it('指定的時間已經過去 → 400 ANNOUNCEMENT_TRIGGER_IN_PAST（details.at），不寫入', async () => {
    const ctx = setup({ stored: announcement({ trigger: { kind: 'once', at: PAST } }) });
    await expectCode(
      run(() => ctx.service.publishAnnouncement('ann-1', { version: 3 }, ACTOR)),
      'ANNOUNCEMENT_TRIGGER_IN_PAST',
      { at: PAST },
    );
    expect(ctx.repo.update).not.toHaveBeenCalled();
  });

  it('週期：排到租戶時區的第一次', async () => {
    const ctx = setup({
      stored: announcement({
        trigger: {
          kind: 'recurring',
          frequency: 'daily',
          interval: 1,
          time: '09:00',
          startsOn: '2026-10-01',
        },
      }),
    });
    await run(() => ctx.service.publishAnnouncement('ann-1', { version: 3 }, ACTOR));
    // NOW 是台北 10/06 08:00：今天的 09:00 還沒到
    expect(ctx.repo.update).toHaveBeenCalledWith(
      'ann-1',
      expect.objectContaining({ nextRunAt: new Date('2026-10-06T01:00:00.000Z') }),
      3,
      ctx.tx,
    );
  });

  it('週期已過結束日期 → 400 ANNOUNCEMENT_TRIGGER_IN_PAST（reason: noOccurrence）', async () => {
    const ctx = setup({
      stored: announcement({
        trigger: {
          kind: 'recurring',
          frequency: 'daily',
          interval: 1,
          time: '09:00',
          startsOn: '2026-09-01',
          endsOn: '2026-09-30',
        },
      }),
    });
    await expectCode(
      run(() => ctx.service.publishAnnouncement('ann-1', { version: 3 }, ACTOR)),
      'ANNOUNCEMENT_TRIGGER_IN_PAST',
      { reason: 'noOccurrence' },
    );
  });

  it('事件點：scheduled 但沒有下一次（等事件發生），不入列任何工作', async () => {
    const ctx = setup({
      stored: announcement({
        trigger: { kind: 'event', event: 'group.memberAdded', delayMinutes: 0 },
      }),
    });
    await run(() => ctx.service.publishAnnouncement('ann-1', { version: 3 }, ACTOR));
    expect(ctx.repo.update).toHaveBeenCalledWith(
      'ann-1',
      { status: 'scheduled', nextRunAt: null, updatedBy: ACTOR.id },
      3,
      ctx.tx,
    );
    expect(ctx.jobs.enqueue).not.toHaveBeenCalled();
  });

  it('寫入時 version 已被別人改掉 → 409 ANNOUNCEMENT_VERSION_CONFLICT，不建立發送', async () => {
    const ctx = setup();
    ctx.repo.update.mockResolvedValue(undefined);
    await expectCode(
      run(() => ctx.service.publishAnnouncement('ann-1', { version: 3 }, ACTOR)),
      'ANNOUNCEMENT_VERSION_CONFLICT',
      { current: 4 },
    );
    expect(ctx.repo.insertDispatch).not.toHaveBeenCalled();
  });
});

describe('AnnouncementService.pause（docs/architecture/backend/19-announcement.md §3、§9.2 D8）', () => {
  it('scheduled → paused、next_run_at 清空，不去佇列取消工作', async () => {
    const ctx = setup({ stored: scheduledOnce() });
    await run(() => ctx.service.pause('ann-1', { version: 3 }, ACTOR));
    expect(ctx.repo.update).toHaveBeenCalledWith(
      'ann-1',
      { status: 'paused', nextRunAt: null, updatedBy: ACTOR.id },
      3,
      ctx.tx,
    );
    expect(ctx.jobs.enqueue).not.toHaveBeenCalled();
  });

  it('稽核記狀態的前後，提交後才發布', async () => {
    const ctx = setup({ stored: scheduledOnce() });
    await run(() => ctx.service.pause('ann-1', { version: 3 }, ACTOR));
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'announcement.pause',
        changes: { before: { status: 'scheduled' }, after: { status: 'paused' } },
        metadata: { nextRunAt: null },
      }),
      ctx.tx,
    );
    expect(ctx.log).toEqual(['begin', 'audit', 'commit', 'publish']);
  });

  it.each(['draft', 'paused', 'completed'] as const)(
    '%s 不能暫停 → 409 ANNOUNCEMENT_INVALID_STATE',
    async (status) => {
      const ctx = setup({ stored: announcement({ status }) });
      await expectCode(
        run(() => ctx.service.pause('ann-1', { version: 3 }, ACTOR)),
        'ANNOUNCEMENT_INVALID_STATE',
        { status },
      );
    },
  );

  it('version 過時 → 409 ANNOUNCEMENT_VERSION_CONFLICT', async () => {
    const ctx = setup({ stored: scheduledOnce() });
    await expectCode(
      run(() => ctx.service.pause('ann-1', { version: 9 }, ACTOR)),
      'ANNOUNCEMENT_VERSION_CONFLICT',
      { current: 3 },
    );
  });

  it('寫入時已被刪除 → 404 ANNOUNCEMENT_NOT_FOUND', async () => {
    const ctx = setup({ stored: scheduledOnce() });
    ctx.repo.update.mockResolvedValue(undefined);
    ctx.repo.findVersion.mockResolvedValue(undefined);
    await expectCode(
      run(() => ctx.service.pause('ann-1', { version: 3 }, ACTOR)),
      'ANNOUNCEMENT_NOT_FOUND',
    );
  });
});

const paused = (trigger: AnnouncementTriggerValue) =>
  announcement({ status: 'paused', trigger, nextRunAt: null });

describe('AnnouncementService.resume（docs/architecture/backend/19-announcement.md §3、§9.2 D10）', () => {
  it('指定時間還沒到：paused → scheduled，交易內重新入列延遲工作', async () => {
    const ctx = setup({ stored: paused({ kind: 'once', at: FUTURE }) });
    await run(() => ctx.service.resume('ann-1', { version: 3 }, ACTOR));
    expect(ctx.repo.update).toHaveBeenCalledWith(
      'ann-1',
      { status: 'scheduled', nextRunAt: new Date(FUTURE), updatedBy: ACTOR.id },
      3,
      ctx.tx,
    );
    expect(ctx.jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'announcement.dispatch' }),
      { announcementId: 'ann-1', runAt: FUTURE },
      { tx: ctx.tx, startAfter: new Date(FUTURE) },
    );
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'announcement.resume', metadata: { nextRunAt: FUTURE } }),
      ctx.tx,
    );
  });

  it('指定的時間在暫停期間過去了 → 400 ANNOUNCEMENT_TRIGGER_IN_PAST，不寫入', async () => {
    const ctx = setup({ stored: paused({ kind: 'once', at: PAST }) });
    await expectCode(
      run(() => ctx.service.resume('ann-1', { version: 3 }, ACTOR)),
      'ANNOUNCEMENT_TRIGGER_IN_PAST',
      { at: PAST },
    );
    expect(ctx.repo.update).not.toHaveBeenCalled();
  });

  it('週期：從現在起算下一次，暫停期間錯過的不補發', async () => {
    const ctx = setup({
      stored: paused({
        kind: 'recurring',
        frequency: 'daily',
        interval: 1,
        time: '07:00',
        startsOn: '2026-09-01',
      }),
    });
    await run(() => ctx.service.resume('ann-1', { version: 3 }, ACTOR));
    // NOW 是台北 10/06 08:00：今天的 07:00 已過，下一次是明天
    expect(ctx.repo.update).toHaveBeenCalledWith(
      'ann-1',
      expect.objectContaining({ nextRunAt: new Date('2026-10-06T23:00:00.000Z') }),
      3,
      ctx.tx,
    );
  });

  it('週期的次數在暫停前已用完 → 400 ANNOUNCEMENT_TRIGGER_IN_PAST', async () => {
    const ctx = setup({
      stored: paused({
        kind: 'recurring',
        frequency: 'daily',
        interval: 1,
        time: '09:00',
        startsOn: '2026-09-01',
        maxOccurrences: 3,
      }),
      dispatchCount: 3,
    });
    await expectCode(
      run(() => ctx.service.resume('ann-1', { version: 3 }, ACTOR)),
      'ANNOUNCEMENT_TRIGGER_IN_PAST',
      { reason: 'noOccurrence' },
    );
  });

  it('事件點：scheduled、沒有下一次，不入列', async () => {
    const ctx = setup({
      stored: paused({ kind: 'event', event: 'user.activated', delayMinutes: 5 }),
    });
    await run(() => ctx.service.resume('ann-1', { version: 3 }, ACTOR));
    expect(ctx.repo.update).toHaveBeenCalledWith(
      'ann-1',
      { status: 'scheduled', nextRunAt: null, updatedBy: ACTOR.id },
      3,
      ctx.tx,
    );
    expect(ctx.jobs.enqueue).not.toHaveBeenCalled();
  });

  it('暫停中的「立即」公告（不該存在的狀態）→ 409 ANNOUNCEMENT_INVALID_STATE', async () => {
    const ctx = setup({ stored: paused({ kind: 'immediate' }) });
    await expectCode(
      run(() => ctx.service.resume('ann-1', { version: 3 }, ACTOR)),
      'ANNOUNCEMENT_INVALID_STATE',
      { status: 'paused' },
    );
  });

  it.each(['draft', 'scheduled', 'completed'] as const)(
    '%s 不能恢復 → 409 ANNOUNCEMENT_INVALID_STATE',
    async (status) => {
      const ctx = setup({ stored: announcement({ status }) });
      await expectCode(
        run(() => ctx.service.resume('ann-1', { version: 3 }, ACTOR)),
        'ANNOUNCEMENT_INVALID_STATE',
        { status },
      );
    },
  );
});

describe('AnnouncementService.remove（docs/architecture/backend/19-announcement.md §3、§9.2 D19）', () => {
  it('軟刪除：鎖住後刪除，稽核記標題與狀態，提交後發布 delete', async () => {
    const ctx = setup({ stored: announcement({ status: 'scheduled' }) });
    await run(() => ctx.service.remove('ann-1', ACTOR));
    expect(ctx.repo.softDelete).toHaveBeenCalledWith('ann-1', ACTOR.id, ctx.tx);
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'announcement.delete',
        resourceName: '季度說明會',
        changes: { before: { title: '季度說明會', status: 'scheduled' } },
      }),
      ctx.tx,
    );
    expect(ctx.log).toEqual(['begin', 'softDelete', 'audit', 'commit', 'publish']);
    expect(ctx.events.publish).toHaveBeenCalledWith(...changed(ChangeKind.DELETE));
  });

  it('不存在 → 404 ANNOUNCEMENT_NOT_FOUND', async () => {
    const ctx = setup();
    ctx.repo.findActive.mockResolvedValue(undefined);
    await expectCode(
      run(() => ctx.service.remove('ann-1', ACTOR)),
      'ANNOUNCEMENT_NOT_FOUND',
    );
  });

  it('檢查之後被別人先刪掉 → 404 ANNOUNCEMENT_NOT_FOUND，不重複刪除', async () => {
    const ctx = setup();
    ctx.repo.lockActive.mockResolvedValue(undefined);
    await expectCode(
      run(() => ctx.service.remove('ann-1', ACTOR)),
      'ANNOUNCEMENT_NOT_FOUND',
    );
    expect(ctx.repo.softDelete).not.toHaveBeenCalled();
    expect(ctx.events.publish).not.toHaveBeenCalled();
  });
});

describe('AnnouncementService.restore（docs/architecture/backend/19-announcement.md §3、§9.2 D19）', () => {
  const deletedAt = new Date('2026-10-04T00:00:00.000Z');

  it('還原：稽核帶刪除時間，提交後以 create 發布（重新出現在列表）', async () => {
    const ctx = setup({ stored: announcement({ status: 'paused' }) });
    ctx.repo.findDeletedById.mockResolvedValue(announcement({ deletedAt }));
    const dto = await run(() => ctx.service.restore('ann-1', ACTOR));
    expect(ctx.repo.restore).toHaveBeenCalledWith('ann-1', ACTOR.id, ctx.tx);
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'announcement.restore',
        changes: { after: { title: '季度說明會', status: 'paused' } },
        metadata: { deletedAt: deletedAt.toISOString() },
      }),
      ctx.tx,
    );
    expect(ctx.events.publish).toHaveBeenCalledWith(...changed(ChangeKind.CREATE));
    expect(dto.status).toBe('paused');
  });

  it('沒有被刪除 → 409 ANNOUNCEMENT_NOT_DELETED', async () => {
    const ctx = setup();
    await expectCode(
      run(() => ctx.service.restore('ann-1', ACTOR)),
      'ANNOUNCEMENT_NOT_DELETED',
    );
    expect(ctx.repo.restore).not.toHaveBeenCalled();
  });

  it('根本不存在 → 404 ANNOUNCEMENT_NOT_FOUND', async () => {
    const ctx = setup();
    ctx.repo.exists.mockResolvedValue(false);
    await expectCode(
      run(() => ctx.service.restore('ann-1', ACTOR)),
      'ANNOUNCEMENT_NOT_FOUND',
    );
  });

  it('檢查之後被別人搶先還原 → 409 ANNOUNCEMENT_NOT_DELETED，不寫稽核', async () => {
    const ctx = setup();
    ctx.repo.findDeletedById.mockResolvedValue(announcement({ deletedAt }));
    ctx.repo.restore.mockResolvedValue(undefined);
    await expectCode(
      run(() => ctx.service.restore('ann-1', ACTOR)),
      'ANNOUNCEMENT_NOT_DELETED',
    );
    expect(ctx.audit.record).not.toHaveBeenCalled();
    expect(ctx.events.publish).not.toHaveBeenCalled();
  });
});

describe('AnnouncementService.previewRecurrence／previewAudience（docs/architecture/backend/19-announcement.md §3、§9.2 D11）', () => {
  it('週期預覽：回租戶時區與接下來最多 5 次（ISO 字串）', async () => {
    const ctx = setup();
    const result = await run(() =>
      ctx.service.previewRecurrence({
        trigger: {
          kind: 'recurring',
          frequency: 'daily',
          interval: 1,
          time: '09:00',
          startsOn: '2026-10-01',
        },
      }),
    );
    expect(result.timeZone).toBe(TAIPEI);
    expect(result.occurrences).toEqual([
      '2026-10-06T01:00:00.000Z',
      '2026-10-07T01:00:00.000Z',
      '2026-10-08T01:00:00.000Z',
      '2026-10-09T01:00:00.000Z',
      '2026-10-10T01:00:00.000Z',
    ]);
  });

  it('週期預覽：次數上限小於 5 時只回那麼多次', async () => {
    const ctx = setup();
    const result = await run(() =>
      ctx.service.previewRecurrence({
        trigger: {
          kind: 'recurring',
          frequency: 'daily',
          interval: 1,
          time: '09:00',
          startsOn: '2026-10-01',
          maxOccurrences: 2,
        },
      }),
    );
    expect(result.occurrences).toHaveLength(2);
  });

  it('受眾預覽：只回人數與略過的來源，不回名單', async () => {
    const ctx = setup();
    const result = await run(() => ctx.service.previewAudience(announcement().audience));
    expect(result).toEqual({
      count: 2,
      skipped: { userIds: [], groupIds: ['group-gone'], roleIds: [] },
    });
  });
});

describe('AnnouncementService.listDispatches（docs/architecture/backend/19-announcement.md §3）', () => {
  it('每列帶目前還在的通知裡的已讀數', async () => {
    const ctx = setup();
    ctx.repo.listDispatches.mockResolvedValue({
      items: [dispatchWithPeople({ status: 'sent', recipientCount: 5 })],
      total: 1,
    });
    ctx.notifications.statsBySources.mockResolvedValue(
      new Map([['disp-1', { total: 5, read: 2 }]]),
    );
    const result = await run(() => ctx.service.listDispatches('ann-1', { offset: 0, limit: 20 }));
    expect(ctx.repo.listDispatches).toHaveBeenCalledWith('ann-1', 0, 20);
    expect(result.items[0]).toMatchObject({
      id: 'disp-1',
      status: 'sent',
      recipientCount: 5,
      readCount: 2,
      createdBy: PERSON,
      revokedBy: null,
    });
  });

  it('公告不存在 → 404 ANNOUNCEMENT_NOT_FOUND', async () => {
    const ctx = setup();
    ctx.repo.findActive.mockResolvedValue(undefined);
    await expectCode(
      run(() => ctx.service.listDispatches('ann-1', { offset: 0, limit: 20 })),
      'ANNOUNCEMENT_NOT_FOUND',
    );
  });
});

describe('AnnouncementService.revoke（docs/architecture/backend/19-announcement.md §3、§9.2 D18）', () => {
  it('發送紀錄改成 revoked（撤回時間、撤回者），在鎖住發送紀錄的交易內寫稽核', async () => {
    const ctx = setup();
    await run(() => ctx.service.revoke('ann-1', 'disp-1', ACTOR));
    expect(ctx.repo.lockDispatch).toHaveBeenCalledWith('disp-1', ctx.tx);
    expect(ctx.repo.updateDispatch).toHaveBeenCalledWith(
      'disp-1',
      { status: 'revoked', revokedAt: NOW, revokedBy: ACTOR.id },
      ctx.tx,
    );
    expect(ctx.audit.record).toHaveBeenCalledWith(
      {
        action: 'announcementDispatch.revoke',
        resourceType: 'announcement',
        resourceId: 'ann-1',
        resourceName: '季度說明會',
        changes: { before: { status: 'sent' }, after: { status: 'revoked' } },
        metadata: { dispatchId: 'disp-1', recipientCount: 12 },
      },
      ctx.tx,
    );
  });

  it('提交之後才刪除通知並發布 update', async () => {
    const ctx = setup();
    await run(() => ctx.service.revoke('ann-1', 'disp-1', ACTOR));
    expect(ctx.notifications.removeBySource).toHaveBeenCalledWith('disp-1');
    expect(ctx.log).toEqual(['begin', 'audit', 'commit', 'removeBySource', 'publish']);
    expect(ctx.events.publish).toHaveBeenCalledWith(...changed(ChangeKind.UPDATE));
  });

  it('回傳的發送紀錄已讀數為 0（通知都刪了）', async () => {
    const ctx = setup();
    const dto = await run(() => ctx.service.revoke('ann-1', 'disp-1', ACTOR));
    expect(dto).toMatchObject({ id: 'disp-1', status: 'revoked', readCount: 0 });
  });

  it('發送中的也可以撤回（分批寫入在下一批看到 revoked 就停）', async () => {
    const ctx = setup();
    ctx.repo.lockDispatch.mockResolvedValue(dispatchRow({ status: 'sending' }));
    await run(() => ctx.service.revoke('ann-1', 'disp-1', ACTOR));
    expect(ctx.repo.updateDispatch).toHaveBeenCalled();
  });

  it('已經撤回 → 409 ANNOUNCEMENT_DISPATCH_NOT_REVOCABLE，不刪通知', async () => {
    const ctx = setup();
    ctx.repo.lockDispatch.mockResolvedValue(dispatchRow({ status: 'revoked' }));
    await expectCode(
      run(() => ctx.service.revoke('ann-1', 'disp-1', ACTOR)),
      'ANNOUNCEMENT_DISPATCH_NOT_REVOCABLE',
      { status: 'revoked' },
    );
    expect(ctx.notifications.removeBySource).not.toHaveBeenCalled();
  });

  it('發送紀錄不存在 → 404 ANNOUNCEMENT_DISPATCH_NOT_FOUND', async () => {
    const ctx = setup();
    ctx.repo.lockDispatch.mockResolvedValue(undefined);
    await expectCode(
      run(() => ctx.service.revoke('ann-1', 'disp-1', ACTOR)),
      'ANNOUNCEMENT_DISPATCH_NOT_FOUND',
    );
  });

  it('發送紀錄屬於別則公告 → 404 ANNOUNCEMENT_DISPATCH_NOT_FOUND，不改它', async () => {
    const ctx = setup();
    ctx.repo.lockDispatch.mockResolvedValue(dispatchRow({ announcementId: 'ann-other' }));
    await expectCode(
      run(() => ctx.service.revoke('ann-1', 'disp-1', ACTOR)),
      'ANNOUNCEMENT_DISPATCH_NOT_FOUND',
    );
    expect(ctx.repo.updateDispatch).not.toHaveBeenCalled();
  });

  it('公告不存在或已刪除 → 404 ANNOUNCEMENT_NOT_FOUND', async () => {
    const ctx = setup();
    ctx.repo.findActive.mockResolvedValue(undefined);
    await expectCode(
      run(() => ctx.service.revoke('ann-1', 'disp-1', ACTOR)),
      'ANNOUNCEMENT_NOT_FOUND',
    );
    expect(ctx.repo.lockDispatch).not.toHaveBeenCalled();
  });

  it('撤回後讀不回發送紀錄（同時被清除）→ 404 ANNOUNCEMENT_DISPATCH_NOT_FOUND', async () => {
    const ctx = setup();
    ctx.repo.findDispatchWithPeople.mockResolvedValue(undefined);
    await expectCode(
      run(() => ctx.service.revoke('ann-1', 'disp-1', ACTOR)),
      'ANNOUNCEMENT_DISPATCH_NOT_FOUND',
    );
  });
});

describe('AnnouncementService.readMessage（docs/architecture/backend/19-announcement.md §3）', () => {
  it('收件人讀全文：標為已讀，寄件時間取開始發送的時間', async () => {
    const ctx = setup();
    const startedAt = new Date('2026-10-05T01:00:05.000Z');
    ctx.repo.findDispatchWithPeople.mockResolvedValue(dispatchWithPeople({ startedAt }));
    const result = await run(() => ctx.service.readMessage('disp-1', ACTOR));
    expect(ctx.notifications.markSourceRead).toHaveBeenCalledWith('disp-1', ACTOR.id);
    expect(result).toEqual({
      dispatchId: 'disp-1',
      title: '季度說明會',
      body: plainTextToRichText('十月的季度說明會改到線上舉行。'),
      sentAt: startedAt.toISOString(),
      sender: PERSON,
    });
  });

  it('還沒開始發送時，寄件時間是計畫時間', async () => {
    const ctx = setup();
    ctx.repo.findDispatchWithPeople.mockResolvedValue(dispatchWithPeople());
    const result = await run(() => ctx.service.readMessage('disp-1', ACTOR));
    expect(result.sentAt).toBe('2026-10-05T01:00:00.000Z');
  });

  it('沒有收到這次發送（或已撤回、已清除通知）→ 404 ANNOUNCEMENT_MESSAGE_NOT_FOUND', async () => {
    const ctx = setup();
    ctx.notifications.markSourceRead.mockResolvedValue(false);
    await expectCode(
      run(() => ctx.service.readMessage('disp-1', ACTOR)),
      'ANNOUNCEMENT_MESSAGE_NOT_FOUND',
    );
  });

  it('發送紀錄不存在 → 404 ANNOUNCEMENT_MESSAGE_NOT_FOUND，不碰通知', async () => {
    const ctx = setup();
    ctx.repo.findDispatchWithPeople.mockResolvedValue(undefined);
    await expectCode(
      run(() => ctx.service.readMessage('disp-1', ACTOR)),
      'ANNOUNCEMENT_MESSAGE_NOT_FOUND',
    );
    expect(ctx.notifications.markSourceRead).not.toHaveBeenCalled();
  });
});

describe('AnnouncementService.listTriggerEvents（docs/architecture/backend/19-announcement.md §5.3）', () => {
  it('依目錄的登記順序列出觸發點與比對方式', async () => {
    const ctx = setup();
    const items = await run(async () => ctx.service.listTriggerEvents());
    expect(items).toEqual([
      { event: 'user.activated', scope: 'audience' },
      { event: 'group.memberAdded', scope: 'group' },
      { event: 'user.roleAssigned', scope: 'role' },
      { event: 'file.uploaded', scope: 'audience' },
    ]);
  });

  it('所屬 feature 沒啟用的觸發點不列出', async () => {
    const ctx = setup();
    const items = await run(async () => ctx.service.listTriggerEvents(), ['announcement']);
    expect(items.map((item) => item.event)).not.toContain('file.uploaded');
  });
});
