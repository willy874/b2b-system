import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '@/core/database';
import { AppException } from '@/core/errors';
import type { DomainEventBus } from '@/core/events';
import type { JobQueue } from '@/core/jobs';
import type { NotificationInput } from '@/modules/notification/notification.definition';
import type { NotificationService } from '@/modules/notification/notification.service';

import { WATCH_NOTIFY_JOB } from '../watch.job-types';
import type { WatchRepository } from '../watch.repository';
import { WatchService } from '../watch.service';
import {
  ACTOR,
  expectCode,
  inTenant,
  OTHER,
  registryWith,
  RESOURCE_ID,
  TARGET,
  THIRD,
} from './comment.fixture';

function setup(options: { viewers?: string[]; watchers?: string[] } = {}) {
  const tx = { tx: true };
  const db = { transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)) };
  const repo = {
    state: vi.fn(async () => ({ watching: true, watcherCount: 2 })),
    watch: vi.fn(async () => true),
    unwatch: vi.fn(async () => true),
    watcherIds: vi.fn(async () => options.watchers ?? []),
    hasWatchers: vi.fn(async () => (options.watchers ?? []).length > 0),
    removeAllFor: vi.fn(async () => undefined),
  };
  const notifications = { notify: vi.fn(async (_inputs: NotificationInput[]) => undefined) };
  const jobs = { enqueue: vi.fn(async () => 'job-1') };
  const events = { publish: vi.fn() };
  const { registry, definition } = registryWith({ viewers: options.viewers });
  const service = new WatchService(
    db as unknown as Database,
    repo as unknown as WatchRepository,
    registry,
    notifications as unknown as NotificationService,
    jobs as unknown as JobQueue,
    events as unknown as DomainEventBus,
  );
  return { service, repo, notifications, jobs, events, definition, tx };
}

const watchChanged = {
  changes: [{ resource: ChangeSource.WATCH, kind: ChangeKind.UPDATE, id: RESOURCE_ID }],
  affectedUserIds: [ACTOR.id],
};

describe('WatchService：端點（docs/architecture/backend/24-comment.md §3.2）', () => {
  it('關注要看得到資源；拒絕時原樣拋出、不寫入', async () => {
    const ctx = setup();
    ctx.definition.resolveViewable.mockRejectedValueOnce(new AppException('USER_NOT_FOUND'));
    await expectCode(
      inTenant(() => ctx.service.watch('user', RESOURCE_ID, ACTOR)),
      'USER_NOT_FOUND',
    );
    expect(ctx.repo.watch).not.toHaveBeenCalled();
    expect(ctx.definition.resolveViewable).toHaveBeenCalledWith(ACTOR, RESOURCE_ID, {
      route: 'PUT /watches/:resourceType/:resourceId',
      metadata: { resourceType: 'user', resourceId: RESOURCE_ID },
    });
  });

  it('開始關注時只推給本人；已經在關注不推', async () => {
    const ctx = setup();
    expect(await inTenant(() => ctx.service.watch('user', RESOURCE_ID, ACTOR))).toEqual({
      watching: true,
      watcherCount: 2,
    });
    expect(ctx.events.publish).toHaveBeenCalledWith('resource.changed', watchChanged);
    ctx.events.publish.mockClear();
    ctx.repo.watch.mockResolvedValue(false);
    await inTenant(() => ctx.service.watch('user', RESOURCE_ID, ACTOR));
    expect(ctx.events.publish).not.toHaveBeenCalled();
  });

  it('取消關注不檢查看不看得到（失去權限的人也能拿掉）', async () => {
    const ctx = setup();
    await inTenant(() => ctx.service.unwatch('user', RESOURCE_ID, ACTOR));
    expect(ctx.definition.resolveViewable).not.toHaveBeenCalled();
    expect(ctx.repo.unwatch).toHaveBeenCalledWith('user', RESOURCE_ID, ACTOR.id);
    expect(ctx.events.publish).toHaveBeenCalledWith('resource.changed', watchChanged);
  });

  it('沒有登記的資源類型回 COMMENT_RESOURCE_TYPE_UNKNOWN', async () => {
    const ctx = setup();
    await expectCode(
      inTenant(() => ctx.service.state('webhook', RESOURCE_ID, ACTOR)),
      'COMMENT_RESOURCE_TYPE_UNKNOWN',
    );
  });
});

describe('WatchService.resourceChanged（D9）', () => {
  it('沒有人關注時不入列', async () => {
    const ctx = setup();
    await ctx.service.resourceChanged(
      { resourceType: 'user', resourceId: RESOURCE_ID, actorId: ACTOR.id },
      ctx.tx as never,
    );
    expect(ctx.jobs.enqueue).not.toHaveBeenCalled();
  });

  it('有人關注：在業務交易內入列，同一個資源 60 秒內只一次', async () => {
    const ctx = setup({ watchers: [OTHER] });
    const change = { resourceType: 'user', resourceId: RESOURCE_ID, actorId: ACTOR.id };
    await ctx.service.resourceChanged(change, ctx.tx as never);
    expect(ctx.repo.hasWatchers).toHaveBeenCalledWith('user', RESOURCE_ID, ctx.tx);
    expect(ctx.jobs.enqueue).toHaveBeenCalledWith(WATCH_NOTIFY_JOB, change, {
      tx: ctx.tx,
      throttle: { key: `user:${RESOURCE_ID}`, seconds: 60 },
    });
  });
});

describe('WatchService.notifyWatchers（watch.notify）', () => {
  const data = { resourceType: 'user', resourceId: RESOURCE_ID, actorId: ACTOR.id };

  it('通知看得到資源的關注者，不含修改的人', async () => {
    const ctx = setup({ viewers: [ACTOR.id, OTHER], watchers: [ACTOR.id, OTHER, THIRD] });
    expect(await inTenant(() => ctx.service.notifyWatchers(data))).toEqual({ notified: 1 });
    const inputs = ctx.notifications.notify.mock.calls[0]?.[0] ?? [];
    expect(inputs).toEqual([
      {
        type: 'watch.resourceUpdated',
        recipientId: OTHER,
        actorId: ACTOR.id,
        params: { resourceType: 'user', resourceName: TARGET.name },
        link: TARGET.link,
      },
    ]);
  });

  it('沒有收件人時不寫', async () => {
    const ctx = setup({ watchers: [ACTOR.id] });
    expect(await inTenant(() => ctx.service.notifyWatchers(data))).toEqual({ notified: 0 });
    expect(ctx.notifications.notify).not.toHaveBeenCalled();
  });

  it('資源已不存在、資源類型沒登記：略過', async () => {
    const ctx = setup({ watchers: [OTHER] });
    ctx.definition.describe.mockResolvedValueOnce(undefined);
    expect(await inTenant(() => ctx.service.notifyWatchers(data))).toEqual({
      skipped: 'RESOURCE_NOT_FOUND',
    });
    expect(
      await inTenant(() => ctx.service.notifyWatchers({ ...data, resourceType: 'webhook' })),
    ).toEqual({ skipped: 'RESOURCE_TYPE_UNAVAILABLE' });
    expect(ctx.notifications.notify).not.toHaveBeenCalled();
  });
});
