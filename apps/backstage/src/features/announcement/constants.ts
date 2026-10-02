import type { ChipTone } from '@/components/Chip';
import type { Announcement, AnnouncementDispatch } from '@/shared/api-sdk';

type AnnouncementStatus = Announcement['status'];
type DispatchStatus = AnnouncementDispatch['status'];

/** 狀態的文字（字面量 key，docs/conventions/06-literal-strings.md）。 */
export const ANNOUNCEMENT_STATUS_LABEL_KEY = {
  draft: 'announcement.status.draft',
  scheduled: 'announcement.status.scheduled',
  paused: 'announcement.status.paused',
  completed: 'announcement.status.completed',
} as const satisfies Record<AnnouncementStatus, string>;

export const ANNOUNCEMENT_STATUS_TONE = {
  draft: 'neutral',
  scheduled: 'brand',
  paused: 'warning',
  completed: 'success',
} as const satisfies Record<AnnouncementStatus, ChipTone>;

export const ANNOUNCEMENT_STATUSES = [
  'draft',
  'scheduled',
  'paused',
  'completed',
] as const satisfies readonly AnnouncementStatus[];

export const DISPATCH_STATUS_LABEL_KEY = {
  pending: 'announcement.dispatch.status.pending',
  sending: 'announcement.dispatch.status.sending',
  sent: 'announcement.dispatch.status.sent',
  failed: 'announcement.dispatch.status.failed',
  revoked: 'announcement.dispatch.status.revoked',
} as const satisfies Record<DispatchStatus, string>;

export const DISPATCH_STATUS_TONE = {
  pending: 'neutral',
  sending: 'brand',
  sent: 'success',
  failed: 'danger',
  revoked: 'warning',
} as const satisfies Record<DispatchStatus, ChipTone>;

/** 觸發方式的文字。 */
export const TRIGGER_KIND_LABEL_KEY = {
  immediate: 'announcement.trigger.immediate',
  once: 'announcement.trigger.once',
  recurring: 'announcement.trigger.recurring',
} as const satisfies Record<Announcement['trigger']['kind'], string>;

/** 送出的確認句子：立即、指定時間、週期各一句。 */
export const PUBLISH_CONFIRM_KEY = {
  immediate: 'announcement.publish.confirmImmediate',
  once: 'announcement.publish.confirmScheduled',
  recurring: 'announcement.publish.confirmRecurring',
} as const satisfies Record<Announcement['trigger']['kind'], string>;

type RecurringTrigger = Extract<Announcement['trigger'], { kind: 'recurring' }>;
export type RecurrenceFrequency = RecurringTrigger['frequency'];

export const RECURRENCE_FREQUENCIES = [
  'daily',
  'weekly',
  'monthly',
] as const satisfies readonly RecurrenceFrequency[];

/** 頻率的選項文字。 */
export const FREQUENCY_LABEL_KEY = {
  daily: 'announcement.recurrence.frequency.daily',
  weekly: 'announcement.recurrence.frequency.weekly',
  monthly: 'announcement.recurrence.frequency.monthly',
} as const satisfies Record<RecurrenceFrequency, string>;

/**
 * 摘要的句子（「每 2 週的週一、週三 09:00」）：依頻率與間隔是不是 1 挑。不用 i18next 的複數：
 * 中文的複數規則只有 `other`，「每天」會變成「每 1 天」。
 */
export const RECURRENCE_SUMMARY_KEY = {
  daily: {
    one: 'announcement.recurrence.summary.daily',
    many: 'announcement.recurrence.summary.dailyEvery',
  },
  weekly: {
    one: 'announcement.recurrence.summary.weekly',
    many: 'announcement.recurrence.summary.weeklyEvery',
  },
  monthly: {
    one: 'announcement.recurrence.summary.monthly',
    many: 'announcement.recurrence.summary.monthlyEvery',
  },
} as const satisfies Record<RecurrenceFrequency, { one: string; many: string }>;

/** 星期幾（0＝週日，與後端相同）。 */
export const WEEKDAY_LABEL_KEY = [
  'announcement.recurrence.weekday.0',
  'announcement.recurrence.weekday.1',
  'announcement.recurrence.weekday.2',
  'announcement.recurrence.weekday.3',
  'announcement.recurrence.weekday.4',
  'announcement.recurrence.weekday.5',
  'announcement.recurrence.weekday.6',
] as const;

/** 選單的星期順序：週一在前。 */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/** 週期的間隔上限（與後端 `ANNOUNCEMENT_RECURRENCE_MAX_INTERVAL` 一致）。 */
export const RECURRENCE_MAX_INTERVAL = 99;

/** 標題、內文的上限（與後端 `announcement.constants.ts` 一致）。 */
export const ANNOUNCEMENT_TITLE_MAX = 120;
export const ANNOUNCEMENT_BODY_MAX = 5000;

/** 發送紀錄每頁幾筆。 */
export const ANNOUNCEMENT_DISPATCH_PAGE_SIZE = 20;
