import {
  EMPTY_RICH_TEXT_DOCUMENT,
  isRichTextEmpty,
  isValidRichTextDocument,
  plainTextToRichText,
} from '@b2b-system/ui/RichTextViewer';

import type { Announcement, AnnouncementAudience } from '@/shared/api-sdk';

import type { AnnouncementDraft } from './AnnouncementForm';
import { EMPTY_TRIGGER_DRAFT, fromTriggerDraft, toTriggerDraft } from './triggerDraft';

export const EMPTY_AUDIENCE: AnnouncementAudience = {
  all: false,
  userIds: [],
  groupIds: [],
  roleIds: [],
};

export const EMPTY_DRAFT: AnnouncementDraft = {
  title: '',
  body: EMPTY_RICH_TEXT_DOCUMENT,
  audience: EMPTY_AUDIENCE,
  trigger: EMPTY_TRIGGER_DRAFT,
};

export function toDraft(announcement: Announcement): AnnouncementDraft {
  return {
    title: announcement.title,
    body: announcement.body,
    audience: announcement.audience,
    trigger: toTriggerDraft(announcement.trigger),
  };
}

/**
 * 還原 session 結束時存下的草稿（`useFormDraft`）：改成富文本之前存下的草稿，內文是純文字，轉成文件。
 */
export function restoreDraft(saved: Partial<AnnouncementDraft>): Partial<AnnouncementDraft> {
  const body: unknown = saved.body;
  return typeof body === 'string' ? { ...saved, body: plainTextToRichText(body) } : saved;
}

/** 表單有沒有輸入任何東西（離開前的確認、session 結束時保留草稿）。 */
export function isDraftDirty(draft: AnnouncementDraft): boolean {
  return draft.title !== '' || !isRichTextEmpty(draft.body);
}

/**
 * 可以存的草稿：標題、內文不空白，指定時間有完整的日期與時間。受眾空著可以存，送出時才擋。
 * 內文以與後端相同的規則檢查（`isValidRichTextDocument`），通過後型別就是 API 接受的形狀。
 */
export function toRequest(draft: AnnouncementDraft) {
  const trigger = fromTriggerDraft(draft.trigger);
  const { body } = draft;
  if (!draft.title.trim() || isRichTextEmpty(body) || !isValidRichTextDocument(body) || !trigger) {
    return undefined;
  }
  return {
    title: draft.title.trim(),
    body,
    audience: draft.audience,
    trigger,
  };
}
