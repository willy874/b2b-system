import { setDateTimeDefaults } from '@b2b-system/web-shared/date';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AnnouncementTrigger } from '@/shared/api-sdk';

import {
  EMPTY_TRIGGER_DRAFT,
  fromTriggerDraft,
  toRecurring,
  toTriggerDraft,
} from '../triggerDraft';

beforeEach(() => setDateTimeDefaults({ timeZone: 'Asia/Taipei' }));
afterEach(() => setDateTimeDefaults({ timeZone: 'Asia/Taipei' }));

describe('發送時間的草稿轉換（triggerDraft）', () => {
  it.each<[string, AnnouncementTrigger]>([
    ['立即', { kind: 'immediate' }],
    ['指定時間', { kind: 'once', at: '2026-10-10T10:00:00.000Z' }],
    [
      '每週',
      {
        kind: 'recurring',
        frequency: 'weekly',
        interval: 2,
        time: '08:30',
        startsOn: '2026-10-01',
        endsOn: null,
        maxOccurrences: null,
        weekdays: [1, 3],
      },
    ],
    [
      '每月最後一天',
      {
        kind: 'recurring',
        frequency: 'monthly',
        interval: 1,
        time: '18:00',
        startsOn: '2026-10-01',
        endsOn: '2027-01-01',
        maxOccurrences: 3,
        monthDay: 'last',
      },
    ],
    ['事件點（延遲 2 天）', { kind: 'event', event: 'user.activated', delayMinutes: 2880 }],
    ['事件點（延遲 90 分鐘）', { kind: 'event', event: 'group.memberAdded', delayMinutes: 90 }],
    ['事件點（不延遲）', { kind: 'event', event: 'user.activated', delayMinutes: 0 }],
  ])('%s：API → 草稿 → API 不變', (_, trigger) => {
    expect(fromTriggerDraft(toTriggerDraft(trigger))).toEqual(trigger);
  });

  it('延遲帶回表單時換成最大的整除單位；0 顯示成「0 天」', () => {
    expect(toTriggerDraft({ kind: 'event', event: 'e', delayMinutes: 2880 })).toMatchObject({
      delayValue: 2,
      delayUnit: 'days',
    });
    expect(toTriggerDraft({ kind: 'event', event: 'e', delayMinutes: 120 })).toMatchObject({
      delayValue: 2,
      delayUnit: 'hours',
    });
    expect(toTriggerDraft({ kind: 'event', event: 'e', delayMinutes: 90 })).toMatchObject({
      delayValue: 90,
      delayUnit: 'minutes',
    });
    expect(toTriggerDraft({ kind: 'event', event: 'e', delayMinutes: 0 })).toMatchObject({
      delayValue: 0,
      delayUnit: 'days',
    });
  });

  it('缺欄位或格式不對 → undefined（表單不能送出）', () => {
    expect(fromTriggerDraft({ ...EMPTY_TRIGGER_DRAFT, kind: 'once', day: '' })).toBeUndefined();
    const recurring = {
      ...EMPTY_TRIGGER_DRAFT,
      kind: 'recurring' as const,
      startsOn: '2026-10-01',
    };
    expect(toRecurring({ ...recurring, startsOn: '' })).toBeUndefined();
    expect(toRecurring({ ...recurring, time: '9:00' })).toBeUndefined();
    expect(toRecurring({ ...recurring, weekdays: [] })).toBeUndefined();
    expect(toRecurring({ ...recurring, endsOn: '2026-09-30' })).toBeUndefined();
    expect(
      fromTriggerDraft({ ...EMPTY_TRIGGER_DRAFT, kind: 'event', event: 'e', delayValue: -1 }),
    ).toBeUndefined();
  });
});
