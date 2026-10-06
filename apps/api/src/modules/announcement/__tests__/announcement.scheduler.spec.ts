import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Transaction } from '@/core/database';
import type { AnnouncementRecurringTrigger } from '@/db/schema';

import { expectCode, fakeJobs, fakeSettings, NOW, scheduler, TAIPEI } from './announcement.fixture';

const FUTURE = '2026-10-10T01:00:00.000Z';
const PAST = '2026-10-01T01:00:00.000Z';
const DAILY_NINE: AnnouncementRecurringTrigger = {
  kind: 'recurring',
  frequency: 'daily',
  interval: 1,
  time: '09:00',
  startsOn: '2026-10-01',
};

function setup(timeZone = TAIPEI) {
  const settings = fakeSettings({ timeZone });
  const jobs = fakeJobs();
  return { scheduler: scheduler(settings, jobs), settings, jobs };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AnnouncementScheduler.nextRun（docs/architecture/backend/19-announcement.md §5、§9.2 D7）', () => {
  it('立即發送與事件點沒有時間表', async () => {
    const { scheduler: target } = setup();
    expect(await target.nextRun({ kind: 'immediate' }, NOW, 0)).toBeUndefined();
    expect(
      await target.nextRun({ kind: 'event', event: 'user.activated', delayMinutes: 0 }, NOW, 0),
    ).toBeUndefined();
  });

  it('指定時間：還沒發過、時間在 after 之後才有下一次', async () => {
    const { scheduler: target } = setup();
    expect(await target.nextRun({ kind: 'once', at: FUTURE }, NOW, 0)).toEqual(new Date(FUTURE));
  });

  it('指定時間：已經發過一次就沒有下一次', async () => {
    const { scheduler: target } = setup();
    expect(await target.nextRun({ kind: 'once', at: FUTURE }, NOW, 1)).toBeUndefined();
  });

  it('指定時間：恰好等於 after 不算（要嚴格在之後）', async () => {
    const { scheduler: target } = setup();
    expect(await target.nextRun({ kind: 'once', at: FUTURE }, new Date(FUTURE), 0)).toBeUndefined();
  });

  it('週期：依租戶時區（general.defaultTimezone）計算', async () => {
    const taipei = setup(TAIPEI);
    const utc = setup('UTC');
    expect(await taipei.scheduler.nextRun(DAILY_NINE, NOW, 0)).toEqual(
      new Date('2026-10-06T01:00:00.000Z'),
    );
    expect(await utc.scheduler.nextRun(DAILY_NINE, NOW, 0)).toEqual(
      new Date('2026-10-06T09:00:00.000Z'),
    );
  });

  it('週期：已發送的次數達到上限就沒有下一次，未達上限照常', async () => {
    const { scheduler: target } = setup();
    const bounded = { ...DAILY_NINE, maxOccurrences: 3 };
    expect(await target.nextRun(bounded, NOW, 3)).toBeUndefined();
    expect(await target.nextRun(bounded, NOW, 2)).toBeInstanceOf(Date);
  });

  it('週期：次數上限是 null 時不限', async () => {
    const { scheduler: target } = setup();
    expect(await target.nextRun({ ...DAILY_NINE, maxOccurrences: null }, NOW, 999)).toBeInstanceOf(
      Date,
    );
  });
});

describe('AnnouncementScheduler.scheduledState／firstRun（docs/architecture/backend/19-announcement.md §3、§7）', () => {
  it('事件點：scheduled、沒有下一次（等事件發生）', async () => {
    const { scheduler: target, settings } = setup();
    expect(
      await target.scheduledState({ kind: 'event', event: 'user.activated', delayMinutes: 0 }, 0),
    ).toEqual({ status: 'scheduled', nextRunAt: null });
    expect(settings.get).not.toHaveBeenCalled();
  });

  it('指定時間：scheduled、下一次是那個時間', async () => {
    const { scheduler: target } = setup();
    expect(await target.scheduledState({ kind: 'once', at: FUTURE }, 0)).toEqual({
      status: 'scheduled',
      nextRunAt: new Date(FUTURE),
    });
  });

  it('指定的時間已過 → 400 ANNOUNCEMENT_TRIGGER_IN_PAST（details.at）', async () => {
    const { scheduler: target } = setup();
    await expectCode(
      target.firstRun({ kind: 'once', at: PAST }, 0),
      'ANNOUNCEMENT_TRIGGER_IN_PAST',
      {
        at: PAST,
      },
    );
  });

  it('週期已過結束日期 → 400 ANNOUNCEMENT_TRIGGER_IN_PAST（reason: noOccurrence）', async () => {
    const { scheduler: target } = setup();
    await expectCode(
      target.firstRun({ ...DAILY_NINE, endsOn: '2026-10-05' }, 0),
      'ANNOUNCEMENT_TRIGGER_IN_PAST',
      { reason: 'noOccurrence' },
    );
  });

  it('週期次數用完 → 400 ANNOUNCEMENT_TRIGGER_IN_PAST（reason: noOccurrence）', async () => {
    const { scheduler: target } = setup();
    await expectCode(
      target.firstRun({ ...DAILY_NINE, maxOccurrences: 1 }, 1),
      'ANNOUNCEMENT_TRIGGER_IN_PAST',
      { reason: 'noOccurrence' },
    );
  });

  it('立即發送沒有第一次 → 400 ANNOUNCEMENT_TRIGGER_IN_PAST', async () => {
    const { scheduler: target } = setup();
    await expectCode(target.firstRun({ kind: 'immediate' }, 0), 'ANNOUNCEMENT_TRIGGER_IN_PAST', {
      reason: 'noOccurrence',
    });
  });
});

describe('AnnouncementScheduler.preview（docs/architecture/backend/19-announcement.md §9.2 D11）', () => {
  it('從現在起接下來最多 count 次，並回租戶時區', async () => {
    const { scheduler: target } = setup();
    const result = await target.preview(DAILY_NINE, 3);
    expect(result).toEqual({
      timeZone: TAIPEI,
      occurrences: [
        new Date('2026-10-06T01:00:00.000Z'),
        new Date('2026-10-07T01:00:00.000Z'),
        new Date('2026-10-08T01:00:00.000Z'),
      ],
    });
  });

  it('次數上限小於 count 時以上限為準（預覽不扣已發送的次數）', async () => {
    const { scheduler: target } = setup();
    const result = await target.preview({ ...DAILY_NINE, maxOccurrences: 2 }, 5);
    expect(result.occurrences).toHaveLength(2);
  });
});

describe('AnnouncementScheduler.enqueue（docs/architecture/backend/19-announcement.md §9.2 D8）', () => {
  it('入列延遲到那個時間的 announcement.dispatch，工作帶上時間、在呼叫端的交易內', async () => {
    const { scheduler: target, jobs } = setup();
    const tx = { name: 'tx' } as unknown as Transaction;
    const runAt = new Date(FUTURE);
    await target.enqueue('ann-1', runAt, tx);
    expect(jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'announcement.dispatch' }),
      { announcementId: 'ann-1', runAt: FUTURE },
      { tx, startAfter: runAt },
    );
  });
});
