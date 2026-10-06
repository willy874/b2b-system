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

describe('nextOccurrence / upcomingOccurrences 的邊界（docs/architecture/backend/19-announcement.md §5.1）', () => {
  it('台北清晨的時間落在前一個 UTC 日：當地今天的 07:00 是 UTC 前一天 23:00', () => {
    const early = trigger({ time: '07:00' });
    expect(nextOccurrence(early, new Date('2026-10-04T22:00:00Z'), TAIPEI)?.toISOString()).toBe(
      '2026-10-04T23:00:00.000Z',
    );
  });

  it('紐約深夜的時間落在下一個 UTC 日：當地今天 23:30 還沒到就是今天', () => {
    const late = trigger({ time: '23:30' });
    // 10/05 23:00 EDT
    expect(nextOccurrence(late, new Date('2026-10-06T03:00:00Z'), NEW_YORK)?.toISOString()).toBe(
      '2026-10-06T03:30:00.000Z',
    );
  });

  it('夏令時間結束（紐約 11/01）：重複的 01:30 取第一次（EDT）', () => {
    const daily = trigger({ time: '01:30', startsOn: '2026-10-31' });
    expect(iso(upcomingOccurrences(daily, new Date('2026-10-31T00:00:00Z'), NEW_YORK, 3))).toEqual([
      '2026-10-31T05:30:00.000Z', // EDT（UTC-4）
      '2026-11-01T05:30:00.000Z', // 當天 01:30 EDT（06:00Z 才切回 EST）
      '2026-11-02T06:30:00.000Z', // EST（UTC-5）
    ]);
  });

  it('夏令時間開始（紐約 03/08）：不存在的 02:30 順延成 03:30 EDT，前後兩天不受影響', () => {
    const daily = trigger({ time: '02:30', startsOn: '2026-03-07' });
    const [before, gap, after] = upcomingOccurrences(
      daily,
      new Date('2026-03-07T00:00:00Z'),
      NEW_YORK,
      3,
    );
    expect(before?.toISOString()).toBe('2026-03-07T07:30:00.000Z');
    expect(gap?.toISOString()).toBe('2026-03-08T07:30:00.000Z'); // 03:30 EDT，不是 01:30 EST
    expect(after?.toISOString()).toBe('2026-03-09T06:30:00.000Z');
  });

  it('每月最後一天遇到閏年 2 月是 29 日', () => {
    const lastDay = trigger({ frequency: 'monthly', monthDay: 'last', startsOn: '2028-02-01' });
    expect(nextOccurrence(lastDay, new Date('2028-02-01T00:00:00Z'), TAIPEI)?.toISOString()).toBe(
      '2028-02-29T01:00:00.000Z',
    );
  });

  it('每兩個月的最後一天：間隔從開始日所在的月份算起', () => {
    const everyOther = trigger({
      frequency: 'monthly',
      monthDay: 'last',
      interval: 2,
      startsOn: '2027-01-15',
    });
    expect(
      iso(upcomingOccurrences(everyOther, new Date('2027-01-01T00:00:00Z'), TAIPEI, 3)),
    ).toEqual(['2027-01-31T01:00:00.000Z', '2027-03-31T01:00:00.000Z', '2027-05-31T01:00:00.000Z']);
  });

  it('每月某日早於開始日的日期：第一次在下個月', () => {
    const fifteenth = trigger({ frequency: 'monthly', monthDay: 15, startsOn: '2026-10-20' });
    expect(nextOccurrence(fifteenth, new Date('2026-10-01T00:00:00Z'), TAIPEI)?.toISOString()).toBe(
      '2026-11-15T01:00:00.000Z',
    );
  });

  it('沒有 monthDay 的每月週期以 1 日計', () => {
    const monthly = trigger({ frequency: 'monthly', monthDay: null });
    expect(nextOccurrence(monthly, new Date('2026-10-05T00:00:00Z'), TAIPEI)?.toISOString()).toBe(
      '2026-11-01T01:00:00.000Z',
    );
  });

  it('每 99 個月一次仍在搜尋範圍內', () => {
    const rare = trigger({ frequency: 'monthly', monthDay: 1, interval: 99 });
    expect(nextOccurrence(rare, new Date('2026-10-02T00:00:00Z'), TAIPEI)?.toISOString()).toBe(
      '2035-01-01T01:00:00.000Z',
    );
  });

  it('跨年的每週：從開始日所在的週算第幾週', () => {
    // 2026-12-31 是週四；那一週（12/27 起）是第 0 週，每兩週的週一是 1/11
    const biweekly = trigger({
      frequency: 'weekly',
      interval: 2,
      weekdays: [1],
      startsOn: '2026-12-31',
    });
    expect(nextOccurrence(biweekly, new Date('2026-12-31T00:00:00Z'), TAIPEI)?.toISOString()).toBe(
      '2027-01-11T01:00:00.000Z',
    );
  });

  it('每週但沒有選星期幾：沒有下一次（不會無限迴圈）', () => {
    expect(
      nextOccurrence(
        trigger({ frequency: 'weekly', weekdays: [] }),
        new Date('2026-10-01T00:00:00Z'),
        TAIPEI,
      ),
    ).toBeUndefined();
    expect(
      nextOccurrence(
        trigger({ frequency: 'weekly', weekdays: null }),
        new Date('2026-10-01T00:00:00Z'),
        TAIPEI,
      ),
    ).toBeUndefined();
  });

  it('結束日期早於開始日期：沒有任何一次', () => {
    const inverted = trigger({ startsOn: '2026-10-10', endsOn: '2026-10-01' });
    expect(nextOccurrence(inverted, new Date('2026-09-01T00:00:00Z'), TAIPEI)).toBeUndefined();
  });

  it('結束日期當天的時間已過：沒有下一次', () => {
    const bounded = trigger({ endsOn: '2026-10-05' });
    expect(nextOccurrence(bounded, new Date('2026-10-05T02:00:00Z'), TAIPEI)).toBeUndefined();
  });

  it('預覽的 count 或剩餘次數為 0：回空陣列', () => {
    const after = new Date('2026-10-01T00:00:00Z');
    expect(upcomingOccurrences(trigger({}), after, TAIPEI, 0)).toEqual([]);
    expect(upcomingOccurrences(trigger({}), after, TAIPEI, 5, 0)).toEqual([]);
  });

  it('非整點時區（加德滿都 UTC+5:45）', () => {
    expect(
      nextOccurrence(
        trigger({}),
        new Date('2026-10-05T00:00:00Z'),
        'Asia/Kathmandu',
      )?.toISOString(),
    ).toBe('2026-10-05T03:15:00.000Z');
  });
});
