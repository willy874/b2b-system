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
} as const satisfies Record<Announcement['trigger']['kind'], string>;

/** 標題、內文的上限（與後端 `announcement.constants.ts` 一致）。 */
export const ANNOUNCEMENT_TITLE_MAX = 120;
export const ANNOUNCEMENT_BODY_MAX = 5000;

/** 發送紀錄每頁幾筆。 */
export const ANNOUNCEMENT_DISPATCH_PAGE_SIZE = 20;
