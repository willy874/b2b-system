import { formatDateTime } from '@b2b-system/web-shared/date';

import type { Announcement } from '@/shared/api-sdk';

import {
  ANNOUNCEMENT_EVENT_LABEL,
  DELAY_UNIT_LABEL_KEY,
  RECURRENCE_SUMMARY_KEY,
  TRIGGER_KIND_LABEL_KEY,
  WEEKDAY_LABEL_KEY,
  WEEKDAY_ORDER,
} from '../constants';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * 觸發方式的一行摘要：「立即發送」、指定的時間，或「每 2 週的週一、週三 09:00（Asia/Taipei 起算…）」。
 * 週期的時間是租戶時區的當地時間，原樣顯示。
 */
export function describeTrigger(
  t: Translate,
  language: string,
  trigger: Announcement['trigger'],
): string {
  switch (trigger.kind) {
    case 'immediate':
      return t(TRIGGER_KIND_LABEL_KEY.immediate);
    case 'once':
      return formatDateTime(trigger.at);
    case 'recurring': {
      const weekdays = WEEKDAY_ORDER.filter((day) => (trigger.weekdays ?? []).includes(day)).map(
        (day) => t(WEEKDAY_LABEL_KEY[day]),
      );
      const keys = RECURRENCE_SUMMARY_KEY[trigger.frequency];
      return t(trigger.interval === 1 ? keys.one : keys.many, {
        interval: trigger.interval,
        time: trigger.time,
        weekdays: new Intl.ListFormat(language, { type: 'conjunction' }).format(weekdays),
        day:
          trigger.monthDay === 'last'
            ? t('announcement.recurrence.lastDay')
            : t('announcement.recurrence.dayOfMonth', { day: trigger.monthDay ?? 1 }),
      });
    }
    case 'event': {
      const known = ANNOUNCEMENT_EVENT_LABEL[trigger.event];
      const event = known ? t(known.nameKey) : trigger.event;
      if (trigger.delayMinutes === 0) return t('announcement.delay.summaryImmediate', { event });
      const unit =
        trigger.delayMinutes % (24 * 60) === 0
          ? { value: trigger.delayMinutes / (24 * 60), key: DELAY_UNIT_LABEL_KEY.days }
          : trigger.delayMinutes % 60 === 0
            ? { value: trigger.delayMinutes / 60, key: DELAY_UNIT_LABEL_KEY.hours }
            : { value: trigger.delayMinutes, key: DELAY_UNIT_LABEL_KEY.minutes };
      return t('announcement.delay.summary', { event, value: unit.value, unit: t(unit.key) });
    }
  }
}
