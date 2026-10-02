import type { Announcement, AnnouncementAudience } from '@/shared/api-sdk';

import type { AnnouncementDraft } from './AnnouncementForm';
import { fromTriggerDraft, toTriggerDraft } from './TriggerField';

export const EMPTY_AUDIENCE: AnnouncementAudience = {
  all: false,
  userIds: [],
  groupIds: [],
  roleIds: [],
};

export const EMPTY_DRAFT: AnnouncementDraft = {
  title: '',
  body: '',
  audience: EMPTY_AUDIENCE,
  trigger: { kind: 'immediate', day: '', time: '09:00' },
};

export function toDraft(announcement: Announcement): AnnouncementDraft {
  return {
    title: announcement.title,
    body: announcement.body,
    audience: announcement.audience,
    trigger: toTriggerDraft(announcement.trigger),
  };
}

/** 可以存的草稿：標題、內文不空白，指定時間有完整的日期與時間。受眾空著可以存，送出時才擋。 */
export function toRequest(draft: AnnouncementDraft) {
  const trigger = fromTriggerDraft(draft.trigger);
  if (!draft.title.trim() || !draft.body.trim() || !trigger) return undefined;
  return {
    title: draft.title.trim(),
    body: draft.body.trim(),
    audience: draft.audience,
    trigger,
  };
}
