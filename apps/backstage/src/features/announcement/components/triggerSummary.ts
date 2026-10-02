import type { Announcement } from '@/shared/api-sdk';
import { formatDateTime } from '@/shared/date';

import {
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
        count: trigger.interval,
        time: trigger.time,
        weekdays: new Intl.ListFormat(language, { type: 'conjunction' }).format(weekdays),
        day:
          trigger.monthDay === 'last'
            ? t('announcement.recurrence.lastDay')
            : t('announcement.recurrence.dayOfMonth', { day: trigger.monthDay ?? 1 }),
      });
    }
  }
}
