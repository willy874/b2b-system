import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import type { AnnouncementRecurrencePreviewRequest } from '@/shared/api-sdk';

import { fetchAnnouncementRecurrencePreviewQuery } from './fetcher';

export const ANNOUNCEMENT_RECURRENCE_PREVIEW_QUERY_KEY =
  'ANNOUNCEMENT_RECURRENCE_PREVIEW_QUERY_KEY';

/**
 * 週期接下來的發送時間：`POST` 但不寫入，當 query 用（設定改變就重抓）。只在後端算，
 * 依租戶時區（docs/adr/0031-announcements.md D11）。
 */
export const getAnnouncementRecurrencePreviewQueryOptions = (
  trigger: AnnouncementRecurrencePreviewRequest['trigger'],
) =>
  queryOptions({
    queryKey: [ANNOUNCEMENT_RECURRENCE_PREVIEW_QUERY_KEY, JSON.stringify(trigger)] as const,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      fetchAnnouncementRecurrencePreviewQuery({ params: { trigger }, signal }),
  });
