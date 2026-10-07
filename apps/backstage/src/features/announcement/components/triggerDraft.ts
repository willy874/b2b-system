import { toZonedParts, zonedDateTime } from '@b2b-system/web-shared/date';

import type { AnnouncementTrigger } from '@/shared/api-sdk';

import { DELAY_UNIT_MINUTES, EVENT_MAX_DELAY_MINUTES } from '../constants';
import type { DelayUnit, RecurrenceFrequency } from '../constants';

/*
 * 發送時間的表單草稿與 API 的觸發方式之間的轉換（純函式）。
 * 畫面在 `TriggerField.tsx`；公告整份草稿的轉換在 `draft.ts`。
 */

export type TriggerKind = AnnouncementTrigger['kind'];
export type RecurringTrigger = Extract<AnnouncementTrigger, { kind: 'recurring' }>;

/**
 * 表單裡的觸發方式。指定時間以使用者偏好的時區編輯、送出前換成 ISO；
 * 週期的日期與時間是 **租戶時區** 的日曆（後端依它計算，D11），原樣送出。
 */
export interface TriggerDraft {
  kind: TriggerKind;
  /** 指定時間的日期（偏好時區）。 */
  day: string;
  /** 指定時間的時間（偏好時區），或週期每次的時間（租戶時區）。 */
  time: string;
  frequency: RecurrenceFrequency;
  interval: number;
  weekdays: number[];
  monthDay: number | 'last';
  startsOn: string;
  endsOn: string;
  maxOccurrences: number | null;
  /** 事件點：觸發點與延遲（以 `delayUnit` 為單位）。 */
  event: string;
  delayValue: number;
  delayUnit: DelayUnit;
}

export const EMPTY_TRIGGER_DRAFT: TriggerDraft = {
  kind: 'immediate',
  day: '',
  time: '09:00',
  frequency: 'weekly',
  interval: 1,
  weekdays: [1],
  monthDay: 1,
  startsOn: '',
  endsOn: '',
  maxOccurrences: null,
  event: '',
  delayValue: 0,
  delayUnit: 'days',
};

/** 分鐘 → 最大的整除單位（1440 → 1 天）。 */
function toDelayParts(minutes: number): { delayValue: number; delayUnit: DelayUnit } {
  if (minutes > 0 && minutes % DELAY_UNIT_MINUTES.days === 0) {
    return { delayValue: minutes / DELAY_UNIT_MINUTES.days, delayUnit: 'days' };
  }
  if (minutes > 0 && minutes % DELAY_UNIT_MINUTES.hours === 0) {
    return { delayValue: minutes / DELAY_UNIT_MINUTES.hours, delayUnit: 'hours' };
  }
  return { delayValue: minutes, delayUnit: minutes === 0 ? 'days' : 'minutes' };
}

export function toTriggerDraft(trigger: AnnouncementTrigger): TriggerDraft {
  switch (trigger.kind) {
    case 'immediate':
      return EMPTY_TRIGGER_DRAFT;
    case 'once': {
      const parts = toZonedParts(trigger.at);
      return {
        ...EMPTY_TRIGGER_DRAFT,
        kind: 'once',
        day: parts?.day ?? '',
        time: parts?.time ?? '09:00',
      };
    }
    case 'recurring':
      return {
        ...EMPTY_TRIGGER_DRAFT,
        kind: 'recurring',
        time: trigger.time,
        frequency: trigger.frequency,
        interval: trigger.interval,
        weekdays: trigger.weekdays ?? [],
        monthDay: trigger.monthDay ?? 1,
        startsOn: trigger.startsOn,
        endsOn: trigger.endsOn ?? '',
        maxOccurrences: trigger.maxOccurrences ?? null,
      };
    case 'event':
      return {
        ...EMPTY_TRIGGER_DRAFT,
        kind: 'event',
        event: trigger.event,
        ...toDelayParts(trigger.delayMinutes),
      };
  }
}

/** 草稿 → 週期；缺必要欄位回 `undefined`（也給下次發送時間的預覽用）。 */
export function toRecurring(draft: TriggerDraft): RecurringTrigger | undefined {
  if (!draft.startsOn || !/^\d{2}:\d{2}$/.test(draft.time)) return undefined;
  if (draft.frequency === 'weekly' && draft.weekdays.length === 0) return undefined;
  if (draft.endsOn && draft.endsOn < draft.startsOn) return undefined;
  return {
    kind: 'recurring',
    frequency: draft.frequency,
    interval: draft.interval,
    time: draft.time,
    startsOn: draft.startsOn,
    endsOn: draft.endsOn || null,
    maxOccurrences: draft.maxOccurrences,
    ...(draft.frequency === 'weekly' && { weekdays: draft.weekdays.toSorted() }),
    ...(draft.frequency === 'monthly' && { monthDay: draft.monthDay }),
  };
}

/** 草稿 → API 的觸發方式；缺欄位或格式不對回 `undefined`（表單不能送出）。 */
export function fromTriggerDraft(draft: TriggerDraft): AnnouncementTrigger | undefined {
  switch (draft.kind) {
    case 'immediate':
      return { kind: 'immediate' };
    case 'once': {
      const at = zonedDateTime(draft.day, draft.time);
      return at ? { kind: 'once', at } : undefined;
    }
    case 'recurring':
      return toRecurring(draft);
    case 'event': {
      const delayMinutes = draft.delayValue * DELAY_UNIT_MINUTES[draft.delayUnit];
      if (!draft.event || delayMinutes < 0 || delayMinutes > EVENT_MAX_DELAY_MINUTES)
        return undefined;
      return { kind: 'event', event: draft.event, delayMinutes };
    }
  }
}
