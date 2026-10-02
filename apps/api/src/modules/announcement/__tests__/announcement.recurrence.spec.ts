import { describe, expect, it } from 'vitest';

import type { AnnouncementRecurringTrigger } from '@/db/schema';

import { nextOccurrence, upcomingOccurrences } from '../announcement.recurrence';

const TAIPEI = 'Asia/Taipei';
const NEW_YORK = 'America/New_York';

function trigger(values: Partial<AnnouncementRecurringTrigger>): AnnouncementRecurringTrigger {
  return {
    kind: 'recurring',
    frequency: 'daily',
    interval: 1,
    time: '09:00',
    startsOn: '2026-10-01',
    ...values,
  };
}

const iso = (dates: Date[]) => dates.map((date) => date.toISOString());

describe('nextOccurrence / upcomingOccurrences（docs/architecture/backend/19-announcement.md §9.2 D7、D11）', () => {
  it('每天 09:00（台北）：今天還沒到就是今天，過了就是明天', () => {
    const daily = trigger({});
    expect(nextOccurrence(daily, new Date('2026-10-05T00:30:00Z'), TAIPEI)?.toISOString()).toBe(
      '2026-10-05T01:00:00.000Z',
    );
    expect(nextOccurrence(daily, new Date('2026-10-05T01:00:00Z'), TAIPEI)?.toISOString()).toBe(
      '2026-10-06T01:00:00.000Z',
    );
  });

  it('開始日期之前不發；每 3 天從開始日算起', () => {
    const everyThreeDays = trigger({ interval: 3, startsOn: '2026-10-10' });
    expect(
      iso(upcomingOccurrences(everyThreeDays, new Date('2026-10-01T00:00:00Z'), TAIPEI, 3)),
    ).toEqual(['2026-10-10T01:00:00.000Z', '2026-10-13T01:00:00.000Z', '2026-10-16T01:00:00.000Z']);
  });

  it('每週一、三，每兩週一次：從開始日所在的那一週算起', () => {
    // 2026-10-01 是週四：那一週（9/27 起）是第 0 週，下一個有效週是 10/11 起
    const biweekly = trigger({ frequency: 'weekly', interval: 2, weekdays: [1, 3] });
    expect(iso(upcomingOccurrences(biweekly, new Date('2026-10-01T00:00:00Z'), TAIPEI, 4))).toEqual(
      [
        '2026-10-12T01:00:00.000Z',
        '2026-10-14T01:00:00.000Z',
        '2026-10-26T01:00:00.000Z',
        '2026-10-28T01:00:00.000Z',
      ],
    );
  });

  it('每月最後一天（含 2 月）；每月 15 日', () => {
    const lastDay = trigger({ frequency: 'monthly', monthDay: 'last', startsOn: '2027-01-01' });
    expect(iso(upcomingOccurrences(lastDay, new Date('2027-01-01T00:00:00Z'), TAIPEI, 3))).toEqual([
      '2027-01-31T01:00:00.000Z',
      '2027-02-28T01:00:00.000Z',
      '2027-03-31T01:00:00.000Z',
    ]);
    const fifteenth = trigger({ frequency: 'monthly', monthDay: 15, interval: 3 });
    expect(
      iso(upcomingOccurrences(fifteenth, new Date('2026-10-01T00:00:00Z'), TAIPEI, 2)),
    ).toEqual(['2026-10-15T01:00:00.000Z', '2027-01-15T01:00:00.000Z']);
  });

  it('夏令時間：紐約每天 09:00 在切換前後都是當地 09:00', () => {
    const daily = trigger({ startsOn: '2026-03-07' });
    expect(iso(upcomingOccurrences(daily, new Date('2026-03-07T00:00:00Z'), NEW_YORK, 3))).toEqual([
      '2026-03-07T14:00:00.000Z', // EST（UTC-5）
      '2026-03-08T13:00:00.000Z', // 當天切成 EDT（UTC-4）
      '2026-03-09T13:00:00.000Z',
    ]);
  });

  it('結束日期（含）之後沒有下一次；次數上限由 upcomingOccurrences 的 remaining 限制', () => {
    const bounded = trigger({ endsOn: '2026-10-02' });
    expect(iso(upcomingOccurrences(bounded, new Date('2026-09-30T00:00:00Z'), TAIPEI, 5))).toEqual([
      '2026-10-01T01:00:00.000Z',
      '2026-10-02T01:00:00.000Z',
    ]);
    expect(nextOccurrence(bounded, new Date('2026-10-02T01:00:00Z'), TAIPEI)).toBeUndefined();
    expect(
      upcomingOccurrences(trigger({}), new Date('2026-10-01T00:00:00Z'), TAIPEI, 5, 2),
    ).toHaveLength(2);
  });

  it('時區不同，同一個當地時間是不同的時刻', () => {
    const daily = trigger({});
    const after = new Date('2026-10-05T00:00:00Z');
    expect(nextOccurrence(daily, after, 'UTC')?.toISOString()).toBe('2026-10-05T09:00:00.000Z');
    expect(nextOccurrence(daily, after, TAIPEI)?.toISOString()).toBe('2026-10-05T01:00:00.000Z');
  });
});
