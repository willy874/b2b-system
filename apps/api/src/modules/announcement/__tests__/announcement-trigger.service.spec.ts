import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Transaction } from '@/core/database';
import type { JobQueue } from '@/core/jobs';
import type { TenantFeature } from '@/core/tenant';

import { AnnouncementTriggerService } from '../announcement-trigger.service';
import type { AnnouncementRepository } from '../announcement.repository';
import { defineAnnouncementTrigger } from '../announcement.triggers';
import {
  catalog,
  FILE_UPLOADED,
  GROUP_MEMBER_ADDED,
  inTenant,
  NOW,
  USER_ROLE_ASSIGNED,
} from './announcement.fixture';

const TX = { name: 'tx' } as unknown as Transaction;

/** 佇列的假物件：fire() 只用批次入列。 */
function batchJobs() {
  return {
    enqueue: vi.fn(),
    enqueueMany: vi.fn(
      async (
        _type: { name: string },
        _items: Array<{ data: object; startAfter?: Date }>,
        _options: object,
      ) => {},
    ),
  };
}

function setup(subscribed: Array<{ id: string; delayMinutes: number }> = []) {
  const repo = {
    findScheduledByEvent: vi.fn(async (_event: string, _tx: unknown) => subscribed),
  };
  const jobs = batchJobs();
  const service = new AnnouncementTriggerService(
    catalog(),
    repo as unknown as AnnouncementRepository,
    jobs as unknown as JobQueue,
  );
  return { service, repo, jobs };
}

/** 這次 fire() 批次入列的每一筆。 */
const itemsOf = (ctx: ReturnType<typeof setup>) => ctx.jobs.enqueueMany.mock.calls[0]?.[1] ?? [];

const fire = (
  ctx: ReturnType<typeof setup>,
  args: Parameters<AnnouncementTriggerService['fire']>,
  features?: TenantFeature[],
) => inTenant(() => ctx.service.fire(...args), features);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AnnouncementTriggerService.fire（docs/architecture/backend/19-announcement.md §5.3、§9.2 D12）', () => {
  it('每則訂了這個觸發點的公告 × 每位使用者入列一筆延遲工作（現在＋延遲），在業務交易內', async () => {
    const ctx = setup([
      { id: 'ann-1', delayMinutes: 0 },
      { id: 'ann-2', delayMinutes: 90 },
    ]);
    await fire(ctx, [GROUP_MEMBER_ADDED, { userIds: ['u1', 'u2'], groupId: 'g1' }, TX]);

    expect(ctx.repo.findScheduledByEvent).toHaveBeenCalledWith('group.memberAdded', TX);
    expect(ctx.jobs.enqueueMany).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ name: 'announcement.eventDispatch' }),
      expect.any(Array),
      { tx: TX },
    );
    const later = new Date(NOW.getTime() + 90 * 60 * 1000);
    expect(itemsOf(ctx)).toHaveLength(4);
    expect(itemsOf(ctx)).toContainEqual({
      data: {
        announcementId: 'ann-2',
        event: 'group.memberAdded',
        userId: 'u2',
        runAt: later.toISOString(),
        groupId: 'g1',
      },
      startAfter: later,
    });
    expect(itemsOf(ctx)).toContainEqual({
      data: expect.objectContaining({
        announcementId: 'ann-1',
        userId: 'u1',
        runAt: NOW.toISOString(),
      }),
      startAfter: NOW,
    });
    expect(ctx.jobs.enqueue).not.toHaveBeenCalled();
  });

  it('100 人 × 3 則公告：outbox 只寫一次（一次批次入列 300 筆）', async () => {
    const ctx = setup([
      { id: 'ann-1', delayMinutes: 0 },
      { id: 'ann-2', delayMinutes: 5 },
      { id: 'ann-3', delayMinutes: 60 },
    ]);
    const userIds = Array.from({ length: 100 }, (_, index) => `u${index}`);
    await fire(ctx, [GROUP_MEMBER_ADDED, { userIds, groupId: 'g1' }, TX]);
    expect(ctx.jobs.enqueueMany).toHaveBeenCalledOnce();
    expect(itemsOf(ctx)).toHaveLength(300);
  });

  it('同一個使用者重複出現只入列一次', async () => {
    const ctx = setup([{ id: 'ann-1', delayMinutes: 0 }]);
    await fire(ctx, [GROUP_MEMBER_ADDED, { userIds: ['u1', 'u1'], groupId: 'g1' }, TX]);
    expect(itemsOf(ctx)).toHaveLength(1);
  });

  it('角色帶進工作資料（比對用）；沒帶群組時資料裡沒有 groupId', async () => {
    const ctx = setup([{ id: 'ann-1', delayMinutes: 0 }]);
    await fire(ctx, [USER_ROLE_ASSIGNED, { userIds: ['u1'], roleIds: ['r1', 'r2'] }, TX]);
    expect(itemsOf(ctx)).toEqual([
      {
        data: {
          announcementId: 'ann-1',
          event: 'user.roleAssigned',
          userId: 'u1',
          runAt: NOW.toISOString(),
          roleIds: ['r1', 'r2'],
        },
        startAfter: NOW,
      },
    ]);
  });

  it('沒有訂閱的公告：只查一次，不入列', async () => {
    const ctx = setup();
    await fire(ctx, [GROUP_MEMBER_ADDED, { userIds: ['u1'], groupId: 'g1' }, TX]);
    expect(ctx.repo.findScheduledByEvent).toHaveBeenCalledTimes(1);
    expect(ctx.jobs.enqueueMany).not.toHaveBeenCalled();
  });

  it('沒有使用者：連公告都不查', async () => {
    const ctx = setup([{ id: 'ann-1', delayMinutes: 0 }]);
    await fire(ctx, [GROUP_MEMBER_ADDED, { userIds: [] }, TX]);
    expect(ctx.repo.findScheduledByEvent).not.toHaveBeenCalled();
  });

  it('租戶停用了公告：直接回，不查不入列', async () => {
    const ctx = setup([{ id: 'ann-1', delayMinutes: 0 }]);
    await fire(ctx, [GROUP_MEMBER_ADDED, { userIds: ['u1'] }, TX], ['file']);
    expect(ctx.repo.findScheduledByEvent).not.toHaveBeenCalled();
    expect(ctx.jobs.enqueueMany).not.toHaveBeenCalled();
  });

  it('觸發點所屬的 feature 沒啟用：直接回', async () => {
    const ctx = setup([{ id: 'ann-1', delayMinutes: 0 }]);
    await fire(ctx, [FILE_UPLOADED, { userIds: ['u1'] }, TX], ['announcement']);
    expect(ctx.repo.findScheduledByEvent).not.toHaveBeenCalled();
  });

  it('沒有登記的觸發點是程式錯誤：拋錯讓業務交易一起失敗', async () => {
    const ctx = setup();
    const stray = defineAnnouncementTrigger('order.shipped', { scope: 'audience' });
    await expect(fire(ctx, [stray, { userIds: ['u1'] }, TX])).rejects.toThrow('order.shipped');
    expect(ctx.repo.findScheduledByEvent).not.toHaveBeenCalled();
  });
});
